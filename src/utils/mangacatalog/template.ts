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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, MangaCatalogSettingsForm } from "./settings";

export interface MangaCatalogEntry {
  title: string;
  /** Path relative to the base URL, e.g. "/manga/one-piece/". */
  url: string;
}

export interface MangaCatalogConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
  /** The hardcoded list of titles this single-franchise site offers. */
  mangaList: MangaCatalogEntry[];
  /** Manga-details DOM layout. */
  detailVariant?: "default" | "card" | "meta";
  /** Chapter-list DOM layout. */
  chapterVariant?: "default" | "gridCol" | "table" | "links";
  /** Page-list DOM layout. */
  pageVariant?: "default" | "entryContent";
  /** Strip "Manga: " prefix from the card-variant title (readopm). */
  stripMangaPrefix?: boolean;
}

class MangaCatalogInterceptor extends PaperbackInterceptor {
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

type MangaCatalogImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaCatalogExtension implements MangaCatalogImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;
  readonly mangaList: MangaCatalogEntry[];
  readonly detailVariant: "default" | "card" | "meta";
  readonly chapterVariant: "default" | "gridCol" | "table" | "links";
  readonly pageVariant: "default" | "entryContent";
  readonly stripMangaPrefix: boolean;

  /** mangaId (path, no leading slash) -> configured title. */
  private readonly titleById = new Map<string, string>();

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MangaCatalogInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangaCatalogConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.mangaList = config.mangaList;
    this.detailVariant = config.detailVariant ?? "default";
    this.chapterVariant = config.chapterVariant ?? "default";
    this.pageVariant = config.pageVariant ?? "default";
    this.stripMangaPrefix = config.stripMangaPrefix ?? false;

    for (const entry of this.mangaList) {
      this.titleById.set(this.pathToId(entry.url), entry.title);
    }

    this.requestManager = new MangaCatalogInterceptor(
      "main",
      () => this.baseUrl,
    );
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaCatalogSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        id: "all_titles",
        title: "Titles",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = this.mangaList.map((entry) => ({
      type: "simpleCarouselItem",
      mangaId: this.pathToId(entry.url),
      imageUrl: "",
      title: entry.title,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search (client-side filter of the hardcoded list)
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const items: SearchResultItem[] = this.mangaList
      .filter(
        (entry) =>
          !titleQuery || entry.title.toLowerCase().includes(titleQuery),
      )
      .map((entry) => ({
        mangaId: this.pathToId(entry.url),
        imageUrl: "",
        title: entry.title,
        subtitle: undefined,
        metadata: undefined,
      }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const configTitle = this.titleById.get(mangaId) ?? "";

    let title = "";
    let description = "";
    let thumbnail = "";

    if (this.detailVariant === "card") {
      description = $("div.card-body > p").text().trim();
      title = $("h2 > span").text().trim();
      if (this.stripMangaPrefix && title.includes("Manga: ")) {
        title = title.split("Manga: ").pop()!.trim();
      }
      thumbnail = this.absUrl($(".card-img-right").attr("src") || "");
    } else if (this.detailVariant === "meta") {
      title = configTitle;
      thumbnail = $("meta[property='og:image']").attr("content") || "";
      description = $("div.entry-content p").first().text().trim();
    } else {
      // default
      const info = $("div.bg-bg-secondary > div.px-6 > div.flex-col")
        .text()
        .trim();
      title = $("div.container > h1").text().trim();
      description = info.includes("Description")
        ? info.split("Description").pop()!.trim()
        : info;
      thumbnail = this.absUrl($("div.flex > img").attr("src") || "");
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title || configTitle || mangaId,
        secondaryTitles: configTitle && configTitle !== title ? [configTitle] : [],
        thumbnailUrl: thumbnail,
        synopsis: description,
        contentRating: this.contentRating,
        status: "Unknown",
        tagGroups: [],
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const chapters: Chapter[] = [];

    let selector: string;
    if (this.chapterVariant === "gridCol") {
      selector = "div.w-full div.grid div.col-span-4";
    } else if (this.chapterVariant === "table") {
      selector = "tbody > tr";
    } else if (this.chapterVariant === "links") {
      selector = "p.has-medium-font-size a[href]";
    } else {
      selector = "div.w-full > div.bg-bg-secondary > div.grid";
    }

    const elements = $(selector).toArray();
    elements.forEach((element, index) => {
      const el = $(element);
      let name = "";
      let href = "";
      let dateText = "";

      if (this.chapterVariant === "table") {
        name = el.find("td:first-child").text().trim();
        href =
          el.find("a.btn-primary").attr("href") ||
          el.find("a").attr("href") ||
          "";
        dateText = el.find("td:nth-child(2)").text().trim();
      } else if (this.chapterVariant === "gridCol") {
        const link = el.find("a").first();
        const main = link.text().trim();
        const sub = el.find("div.text-xs").first().text().trim();
        name = [main, sub].filter((s) => s.length > 0).join(" - ");
        href = link.attr("href") || "";
      } else if (this.chapterVariant === "links") {
        name = el.text().trim();
        href = el.attr("href") || "";
      } else {
        // default
        const link = el.find(".col-span-4 > a");
        const name1 = link.text().trim();
        const name2 = el.find(".text-xs:not(a)").text().trim();
        name = name2.length > 0 ? `${name1} - ${name2}` : name1;
        href = link.attr("href") || "";
      }

      if (!href) return;
      const chapterId = this.parseChapterId(href);
      if (!chapterId) return;

      let chapNum = NaN;
      const numMatch = name.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const anyNum = name.match(/(\d+(?:\.\d+)?)/);
        if (anyNum) chapNum = parseFloat(anyNum[1]);
      }
      // Fall back to source order so chapters always have a number.
      if (isNaN(chapNum)) chapNum = elements.length - index;

      chapters.push({
        chapterId,
        sourceManga,
        title: name || undefined,
        volume: 0,
        chapNum,
        publishDate: dateText ? this.parseDate(dateText) : undefined,
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(chapter.chapterId)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    if (this.pageVariant === "entryContent") {
      $("div.entry-content img").each((_, element) => {
        const src = this.imageFromElement($(element));
        if (src) pages.push(src);
      });
    } else {
      // default
      $("img[data-src]").each((_, element) => {
        const src = this.absUrl($(element).attr("data-src") || "");
        if (src) pages.push(src);
      });
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return `${this.baseUrl}/${this.safeDecode(mangaId)}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private pathToId(path: string): string {
    const cleaned = path
      .replace(this.defaultBaseUrl, "")
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    return this.toSafeId(cleaned);
  }

  private parseChapterId(href: string): string {
    const cleaned = href
      .replace(/[?#].*$/, "")
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(this.defaultBaseUrl, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    return this.toSafeId(cleaned);
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
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

  private absUrl(src: string): string {
    const s = src.trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${this.baseUrl}${s}` : `${this.baseUrl}/${s}`;
  }

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("src") ||
      "";
    return this.absUrl(src);
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
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
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
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
}
