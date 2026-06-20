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
  SortingOption,
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { getBaseUrlOverride, MMRCMSSettingsForm } from "./settings";

export interface MMRCMSConfig {
  name: string;
  baseUrl: string;
  itemPath?: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface MMRCMSSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

interface MMRCMSSuggestion {
  value: string;
  data: string;
}

interface MMRCMSSearchResult {
  suggestions: MMRCMSSuggestion[];
}

class MMRCMSInterceptor extends PaperbackInterceptor {
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
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

type MMRCMSImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

const SORT_OPTIONS: { id: string; label: string }[] = [
  { id: "views", label: "Most Views" },
  { id: "latest", label: "Latest" },
];

export class MMRCMSExtension implements MMRCMSImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly itemPath: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;
  static readonly SEARCH_PAGE_SIZE = 24;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MMRCMSInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MMRCMSConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.itemPath = config.itemPath ?? "manga";
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MMRCMSInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new MMRCMSSettingsForm(this.sourceName, this.defaultBaseUrl);
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular_section",
        title: "Most Viewed",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest_section",
        title: "Latest",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let sort: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        sort = "views";
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        sort = "latest";
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

    const url = `${this.baseUrl}/comic-list?sort=${sort}&page=1`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    this.eachListItem($, (mangaId, title, image) => {
      if (title && mangaId && !seen.has(mangaId)) {
        seen.add(mangaId);
        items.push({
          type: itemType,
          mangaId,
          imageUrl: image,
          title,
          metadata: undefined,
        });
      }
    });

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Sorting
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((o) => ({ id: o.id, label: o.label }));
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MMRCMSSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const titleQuery = (query.title || "").trim();

    if (titleQuery) {
      // Title search uses a JSON suggestions endpoint; paginate the
      // returned directory client-side.
      const json = await this.fetchJson<MMRCMSSearchResult>({
        url: `${this.baseUrl}/search?query=${encodeURIComponent(titleQuery)}`,
        method: "GET",
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "x-requested-with": "XMLHttpRequest",
        },
      });

      const suggestions = json.suggestions ?? [];
      const start = (page - 1) * MMRCMSExtension.SEARCH_PAGE_SIZE;
      const slice = suggestions.slice(
        start,
        start + MMRCMSExtension.SEARCH_PAGE_SIZE,
      );

      const results: SearchResultItem[] = slice.map((s) => {
        const path = `/${this.itemPath}/${s.data}`;
        return {
          mangaId: this.toSafeId(path),
          imageUrl: this.guessCover(path, undefined),
          title: s.value,
          subtitle: undefined,
          metadata: undefined,
        };
      });

      const hasNextPage =
        start + MMRCMSExtension.SEARCH_PAGE_SIZE < suggestions.length;
      const reachedLimit = page >= MMRCMSExtension.MAX_SEARCH_PAGES;

      return {
        items: results,
        metadata:
          hasNextPage && !reachedLimit ? { page: page + 1 } : undefined,
      };
    }

    // Empty query: browse the comic list, optionally sorted.
    const sort = sortingOption?.id || "views";
    const url = `${this.baseUrl}/comic-list?sort=${sort}&page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    this.eachListItem($, (mangaId, title, image) => {
      if (!title || !mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      results.push({
        mangaId,
        imageUrl: image,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $("nav a[rel=next]").length > 0;
    const reachedLimit = page >= MMRCMSExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedLimit
          ? { page: page + 1, collectedIds: [...seen] }
          : undefined,
    };
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, image: string) => void,
  ): void {
    $("div.comic-list-layout .grid > .group").each((_, element) => {
      const el = $(element);
      const link = el.find("a.block.text-sm.font-semibold").first();
      const href = link.attr("href") || "";
      const title = link.text().trim();
      const mangaId = this.parsePath(href);
      const rawSrc = el.find("img").first().attr("src");
      const image = this.guessCover(this.stripDomain(href), rawSrc);
      cb(mangaId, title, image);
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h1.text-2xl").first().text().trim();
    const rawCover = this.imageFromElement(
      $("img.w-full.rounded-xl").first(),
    );
    const image = this.guessCover(this.safeDecode(mangaId), rawCover);
    const description = $("p.mt-5.text-sm").first().text().trim();

    const statusText = $("div.flex.flex-wrap.gap-2 span.rounded-full")
      .first()
      .text()
      .trim();

    const genres: string[] = [];
    $("dl div:contains(Genres:) a").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const authors: string[] = [];
    $("div:has(span:contains(Author:)) > a").each((_, el) => {
      const a = $(el).text().trim();
      if (a) authors.push(a);
    });
    const author = authors.length > 0 ? authors.join(", ") : undefined;

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: image,
        author,
        artist: undefined,
        synopsis: description,
        contentRating: this.contentRating,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaUrl = this.getMangaShareUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    const mangaTitle = $("h1.text-2xl").first().text().trim();

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const elements = $(".overflow-hidden.border-ink-600 > a").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const rawName =
        el.find(".text-brand-400").first().text().trim() ||
        el.text().trim();
      const name = this.cleanChapterName(mangaTitle, rawName);

      let publishDate = new Date(0);
      const dateStr = el.find(".text-slate-500").first().text().trim();
      const parsed = this.parseDate(dateStr);
      if (parsed) publishDate = parsed;

      let chapNum = -1;
      const numMatch = rawName.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        chapNum = elements.length - index;
      }

      chapters.push({
        chapterId,
        sourceManga,
        title: name || `Chapter ${chapNum}`,
        volume: 0,
        chapNum,
        publishDate,
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.getMangaShareUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url: chapterUrl, method: "GET" });

    const pages: string[] = [];
    $("#reader-all img").each((_, img) => {
      const url = this.imageFromElement($(img));
      if (url) pages.push(url);
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const path = this.safeDecode(mangaId);
    return `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private guessCover(mangaPath: string, url: string | undefined): string {
    if (!url || url.endsWith("no-image.png")) {
      const slug = mangaPath.replace(/\/+$/, "").split("/").pop() || "";
      return `${this.baseUrl}/uploads/manga/${slug}/cover/cover_250x350.jpg`;
    }
    return this.absUrl(url);
  }

  private cleanChapterName(mangaTitle: string, name: string): string {
    // RCO uses an empty chapterString, so the manga title prefix is stripped.
    let initial = name;
    if (mangaTitle && initial.startsWith(mangaTitle)) {
      initial = initial.slice(mangaTitle.length).trim();
    }
    const splits = initial.split(":").map((s) => s.trim());
    if (splits.length < 2 || splits[0] === splits[1]) {
      return splits[0] || initial.trim();
    }
    return `${splits[0]}: ${splits.slice(1).join(":").trim()}`;
  }

  private absUrl(href: string): string {
    let src = href.trim();
    if (!src) return "";
    if (!src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }

  private stripDomain(href: string): string {
    let cleaned = href.replace(/[?#].*$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    if (!cleaned.startsWith("/")) cleaned = `/${cleaned}`;
    return cleaned.replace(/\/+$/, "");
  }

  private parsePath(href: string): string {
    return this.toSafeId(this.stripDomain(href));
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-background-image") ||
      img.attr("data-cfsrc") ||
      img.attr("data-lazy-src") ||
      img.attr("data-src") ||
      img.attr("src") ||
      "";
    src = src.trim().replace(/#.*$/, "");
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }

  private parseStatus(status: string): string {
    const s = status.toLowerCase().trim();
    if (!s) return "Unknown";
    if (s.includes("complete") || s.includes("finished")) return "Completed";
    if (s.includes("ongoing") || s.includes("active")) return "Ongoing";
    if (s.includes("drop")) return "Cancelled";
    if (s.includes("hold") || s.includes("hiatus")) return "Hiatus";
    return "Unknown";
  }

  private parseDate(text: string): Date | undefined {
    const t = text.trim();
    if (!t) return undefined;
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d;
    return undefined;
  }

  // ----------------------------------------------------------------
  // Cloudflare + fetch
  // ----------------------------------------------------------------

  async cloudflareBypassCompleted(
    _request: globalThis.Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      this.cookieStorageInterceptor.deleteCookie(cookie);
    }
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(htmlStr);
    return cheerio.load(dom);
  }

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}
