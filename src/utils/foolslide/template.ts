import {
  BasicRateLimiter,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  CloudflareBypassRequestProviding,
  CloudflareError,
  ContentRating,
  Cookie,
  CookieStorageInterceptor,
  DiscoverSection,
  DiscoverSectionItem,
  DiscoverSectionProviding,
  DiscoverSectionType,
  Extension,
  Form,
  MangaProviding,
  Metadata,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SettingsFormProviding,
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { FoolSlideSettingsForm, getBaseUrlOverride, getShowAdult } from "./settings";

// Paperback rejects an empty `imageUrl`/`thumbnailUrl` ("could not convert
// JSValue: invalid URL"). FoolSlide's "Latest releases" page lists each series
// without a cover thumbnail (only the Directory page embeds `img.preview`), so
// cover-less items fall back to this inline data: URI placeholder. An inline
// SVG never 404s/expires the way a hosted placeholder would.
const PLACEHOLDER_COVER =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAi" +
  "IGhlaWdodD0iNDUwIiB2aWV3Qm94PSIwIDAgMzAwIDQ1MCI+PHJlY3Qgd2lkdGg9IjMw" +
  "MCIgaGVpZ2h0PSI0NTAiIGZpbGw9IiMyMzI4MmYiLz48dGV4dCB4PSIxNTAiIHk9IjIy" +
  "NSIgZmlsbD0iIzhhOTNhMyIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6" +
  "ZT0iMjQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRk" +
  "bGUiPk5vIENvdmVyPC90ZXh0Pjwvc3ZnPg==";

export interface FoolSlideConfig {
  name: string;
  baseUrl: string;
  urlModifier?: string;
  contentRating?: ContentRating;
  langCode?: string;
}

class FoolSlideInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    request.headers = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

type FoolSlideImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class FoolSlideExtension implements FoolSlideImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly urlModifier: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  private readonly requestManager: FoolSlideInterceptor;
  private readonly cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  private readonly globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: FoolSlideConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.urlModifier = config.urlModifier ?? "";
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new FoolSlideInterceptor("main", () => this.baseUrl);
  }

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  get prefix(): string {
    return `${this.baseUrl}${this.urlModifier}`;
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new FoolSlideSettingsForm(this.sourceName, this.defaultBaseUrl);
  }

  // ------------------------------------------------------------------ Discover

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular_section",
        title: "Directory",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest_section",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as { page?: number } | undefined;
    const page = meta?.page ?? 1;

    const path = section.id === "latest_section" ? "latest" : "directory";
    const itemType =
      section.id === "latest_section"
        ? "simpleCarouselItem"
        : "featuredCarouselItem";

    const url = `${this.prefix}/${path}/${page}/`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    $("div.group").each((_: number, element) => {
      const group = $(element);
      const link = group.find("a[title]").first();
      const href = link.attr("href");
      if (!href) {
        return;
      }
      const mangaId = this.parseMangaId(href);
      if (!mangaId || seen.has(mangaId)) {
        return;
      }
      seen.add(mangaId);

      let imageUrl = "";
      const img = group.find("img").first();
      if (img.length > 0) {
        imageUrl = this.resolveUrl(img.attr("src") ?? "").replace(
          "/thumb_",
          "/",
        );
      }

      items.push({
        type: itemType,
        mangaId,
        title: link.text().trim() || link.attr("title")?.trim() || mangaId,
        imageUrl: imageUrl || PLACEHOLDER_COVER,
      } as DiscoverSectionItem);
    });

    const hasNext =
      $("div.next").length > 0 && page < FoolSlideExtension.MAX_SEARCH_PAGES;

    return {
      items,
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  // -------------------------------------------------------------------- Search

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = query.title?.trim() ?? "";
    void metadata;

    const showAdult = getShowAdult(this.sourceName);
    const body = `search=${encodeURIComponent(titleQuery)}&adult=${showAdult}`;

    const $ = await this.fetchCheerioPost(`${this.prefix}/search/`, body);

    const items: SearchResultItem[] = [];
    const seen = new Set<string>();

    $("div.group").each((_: number, element) => {
      const group = $(element);
      const link = group.find("a[title]").first();
      const href = link.attr("href");
      if (!href) {
        return;
      }
      const mangaId = this.parseMangaId(href);
      if (!mangaId || seen.has(mangaId)) {
        return;
      }
      seen.add(mangaId);

      let imageUrl = "";
      const img = group.find("img").first();
      if (img.length > 0) {
        imageUrl = this.resolveUrl(img.attr("src") ?? "").replace(
          "/thumb_",
          "/",
        );
      }

      items.push({
        mangaId,
        title: link.text().trim() || link.attr("title")?.trim() || mangaId,
        imageUrl: imageUrl || PLACEHOLDER_COVER,
      });
    });

    return { items, metadata: undefined };
  }

  // ------------------------------------------------------------------- Details

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const showAdult = getShowAdult(this.sourceName);
    const $ = await this.fetchCheerioPost(url, `adult=${showAdult}`);

    const info = $("div.info");
    const infoHtml = info.html() ?? "";

    const author = this.matchInfo(
      infoHtml,
      /(?:Author|Autore)<\/b>:\s?([^\n<]*)[\n<]/i,
    );
    const artist = this.matchInfo(
      infoHtml,
      /Artist<\/b>:\s?([^\n<]*)[\n<]/i,
    );
    const description = this.matchInfo(
      infoHtml,
      /(?:Synopsis|Description|Trama)<\/b>:\s?([^\n<]*)[\n<]/i,
    );

    let thumbnailUrl = "";
    const thumb = $("div.thumbnail img, table.thumb img").first();
    if (thumb.length > 0) {
      thumbnailUrl = this.resolveUrl(thumb.attr("src") ?? "");
    }
    // If the details page has no cover image, fall back to the first page of
    // the series' first chapter (mirrors keiyoushi's getDetailsThumbnail).
    if (!thumbnailUrl) {
      thumbnailUrl = await this.thumbnailFromFirstChapter($);
    }

    const title =
      $("h1.title").first().text().trim() ||
      info.find("h1").first().text().trim() ||
      this.titleFromId(mangaId);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: thumbnailUrl || PLACEHOLDER_COVER,
        author: author || undefined,
        artist: artist || undefined,
        synopsis: description,
        contentRating: this.contentRating,
        status: "Unknown",
        tagGroups: [] as TagSection[],
        shareUrl: url,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const showAdult = getShowAdult(this.sourceName);
    const $ = await this.fetchCheerioPost(url, `adult=${showAdult}`);

    const chapters: Chapter[] = [];

    $("div.group div.element, div.list div.element").each((_: number, element) => {
      const el = $(element);
      const link = el.find("a[title]").first();
      const href = link.attr("href");
      if (!href) {
        return;
      }
      const chapterId = this.parseChapterId(href);
      const name = link.text().trim();
      const dateText = el.find("div.meta_r").first().text().trim();
      const publishDate = this.parseDate(dateText);

      chapters.push({
        chapterId,
        sourceManga,
        title: name || undefined,
        volume: 0,
        chapNum: this.parseChapterNumber(name, href),
        publishDate,
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const pages = await this.fetchChapterPages(url);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return this.mangaUrl(mangaId);
  }

  // ---------------------------------------------------------------- Cloudflare

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    void _request;
    void _localStorage;
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      this.cookieStorageInterceptor.deleteCookie(cookie);
    }
    const now = Date.now();
    for (const cookie of cookies) {
      if (!cookie.expires || cookie.expires.getTime() > now) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  // ------------------------------------------------------------------- Helpers

  private async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const html = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(html);
    return cheerio.load(dom);
  }

  private async fetchCheerioPost(
    url: string,
    body: string,
  ): Promise<CheerioAPI> {
    return this.fetchCheerio({
      url,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  // Derives a cover from the series' first chapter when the details page has
  // none: the chapter list is newest-first, so the LAST element is chapter 1.
  // Fetches that chapter and returns its first page image. Any failure yields
  // an empty string so the caller can fall back to a placeholder.
  private async thumbnailFromFirstChapter($: CheerioAPI): Promise<string> {
    const elements = $("div.group div.element, div.list div.element");
    const last = elements.last();
    if (last.length === 0) {
      return "";
    }
    const href = last.find("a[title]").first().attr("href");
    if (!href) {
      return "";
    }
    try {
      const pages = await this.fetchChapterPages(this.resolveUrl(href));
      return pages[0] ?? "";
    } catch {
      return "";
    }
  }

  // Fetches a chapter page and extracts its image URLs from the embedded
  // `var pages = [...]` JSON array. Returns an empty array on any failure.
  private async fetchChapterPages(url: string): Promise<string[]> {
    const showAdult = getShowAdult(this.sourceName);
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `adult=${showAdult}`,
    });
    if (response.status === 404) {
      throw new Error("Chapter not found");
    }
    const html = Application.arrayBufferToUTF8String(data);

    const pages: string[] = [];
    const match = html.match(/var pages = (\[[\s\S]*?\]);/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]) as { url?: string }[];
        for (const entry of parsed) {
          if (entry && typeof entry.url === "string") {
            pages.push(this.resolveUrl(entry.url));
          }
        }
      } catch {
        // ignore parse failure; pages stays empty
      }
    }
    return pages;
  }

  private resolveUrl(href: string): string {
    const trimmed = href.trim();
    if (trimmed.length === 0) {
      return "";
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.startsWith("//")) {
      return `https:${trimmed}`;
    }
    if (trimmed.startsWith("/")) {
      return `${this.baseUrl}${trimmed}`;
    }
    return `${this.baseUrl}/${trimmed}`;
  }

  private sitePath(href: string): string {
    let path = href.trim();
    path = path.replace(/^https?:\/\/[^/]+/i, "");
    path = path.replace(/[?#].*$/, "");
    path = path.replace(/\/+$/, "");
    path = path.replace(/^\/+/, "");
    return path;
  }

  private parseMangaId(href: string): string {
    return this.toSafeId(this.sitePath(href));
  }

  private parseChapterId(href: string): string {
    return this.toSafeId(this.sitePath(href));
  }

  private mangaUrl(mangaId: string): string {
    return `${this.baseUrl}/${this.safeDecode(mangaId)}/`;
  }

  private chapterUrl(chapterId: string): string {
    return `${this.baseUrl}/${this.safeDecode(chapterId)}/`;
  }

  private titleFromId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const segments = decoded.split("/").filter((s) => s.length > 0);
    const last = segments[segments.length - 1] ?? decoded;
    return last.replace(/[-_]+/g, " ").trim();
  }

  private matchInfo(html: string, regex: RegExp): string {
    const match = html.match(regex);
    return match && match[1] ? match[1].trim() : "";
  }

  private parseChapterNumber(name: string, href: string): number {
    const fromName = name.match(/(\d+(?:\.\d+)?)/);
    if (fromName) {
      const n = parseFloat(fromName[1]);
      if (!isNaN(n)) {
        return n;
      }
    }
    const fromHref = this.safeDecode(href).match(/(\d+(?:\.\d+)?)\/?$/);
    if (fromHref) {
      const n = parseFloat(fromHref[1]);
      if (!isNaN(n)) {
        return n;
      }
    }
    return -1;
  }

  private parseDate(text: string): Date {
    const cleaned = text.includes(",")
      ? text.substring(text.indexOf(",") + 1).trim()
      : text.trim();
    if (cleaned.length === 0) {
      return new Date(0);
    }

    const relative = cleaned.match(
      /(\d+)\s*(sec|second|min|minute|hour|hr|day|week|wk|month|year|yr)/i,
    );
    if (relative) {
      const amount = parseInt(relative[1], 10);
      const unit = relative[2].toLowerCase();
      const now = Date.now();
      const ms = this.unitToMillis(unit) * amount;
      return new Date(now - ms);
    }

    const parsed = new Date(cleaned.replace(/\./g, "-"));
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    return new Date(0);
  }

  private unitToMillis(unit: string): number {
    if (unit.startsWith("sec")) return 1000;
    if (unit.startsWith("min")) return 60 * 1000;
    if (unit.startsWith("hour") || unit === "hr") return 60 * 60 * 1000;
    if (unit.startsWith("day")) return 24 * 60 * 60 * 1000;
    if (unit.startsWith("week") || unit === "wk") return 7 * 24 * 60 * 60 * 1000;
    if (unit.startsWith("month")) return 30 * 24 * 60 * 60 * 1000;
    if (unit.startsWith("year") || unit === "yr")
      return 365 * 24 * 60 * 60 * 1000;
    return 0;
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      return enc !== c
        ? enc
        : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    });
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }
}
