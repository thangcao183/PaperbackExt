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
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { getBaseUrlOverride, LilianaSettingsForm } from "./settings";

export interface LilianaConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface LilianaSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

class LilianaInterceptor extends PaperbackInterceptor {
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

type LilianaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class LilianaExtension implements LilianaImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: LilianaInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: LilianaConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new LilianaInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new LilianaSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        title: "Popular This Week",
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
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let url: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        url = `${this.baseUrl}/ranking/week/1`;
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        url = `${this.baseUrl}/all-manga/1/?sort=last_update&status=0`;
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

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
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as LilianaSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery) {
      url = `${this.baseUrl}/search/${page}/?keyword=${encodeURIComponent(
        titleQuery,
      )}`;
    } else {
      url = `${this.baseUrl}/all-manga/${page}/?sort=last_update&status=0`;
    }

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

    const hasNextPage =
      $(".blog-pager > span.pagecurrent + span").length > 0;
    const reachedLimit = page >= LilianaExtension.MAX_SEARCH_PAGES;

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
    $("div#main div.grid > div").each((_, element) => {
      const el = $(element);
      const link = el.find(".text-center a").first();
      const href = link.attr("href") || "";
      const title = link.text().trim();
      const mangaId = this.parsePath(href);
      const image = this.imageFromElement(el.find("img").first());
      cb(mangaId, title, image);
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $(".a2 header h1").first().text().trim();
    const image = this.imageFromElement($(".a1 > figure img").first());
    const description = $("div#syn-target").first().text().trim();

    const genres: string[] = [];
    $(".a2 div > a[rel='tag'].label").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    let author: string | undefined = $(
      "div.y6x11p i.fas.fa-user + span.dt",
    )
      .first()
      .text()
      .trim();
    if (!author || author.toLowerCase() === "updating") {
      author = undefined;
    }

    const statusText = $("div.y6x11p i.fas.fa-rss + span.dt")
      .first()
      .text()
      .trim();

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

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const elements = $("ul > li.chapter").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = link.text().trim();

      let publishDate = new Date(0);
      const dt = el.find("time[datetime]").first().attr("datetime");
      if (dt) {
        const epoch = parseInt(dt, 10);
        if (!isNaN(epoch)) publishDate = new Date(epoch * 1000);
      }

      let chapNum = -1;
      const numMatch = name.match(/(\d+(?:\.\d+)?)/);
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
    const $page = await this.fetchCheerio({ url: chapterUrl, method: "GET" });

    // Extract `const CHAPTER_ID = <id>;` from an inline script.
    let chapterScriptId = "";
    $page("script").each((_, el) => {
      if (chapterScriptId) return;
      const data = $page(el).contents().text();
      const idx = data.indexOf("const CHAPTER_ID");
      if (idx !== -1) {
        const m = data.match(/const\s+CHAPTER_ID\s*=\s*([^;]+);/);
        if (m) chapterScriptId = m[1].trim();
      }
    });

    if (!chapterScriptId) {
      throw new Error("Failed to get chapter id");
    }

    const json = await this.fetchJson<{
      status?: boolean;
      msg?: string;
      html?: string;
    }>({
      url: `${this.baseUrl}/ajax/image/list/chap/${chapterScriptId}`,
      method: "GET",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        referer: chapterUrl,
        "x-requested-with": "XMLHttpRequest",
      },
    });

    if (json.status === false) {
      throw new Error(json.msg || "Unknown error");
    }

    const $ = cheerio.load(htmlparser2.parseDocument(json.html || ""));
    const pages: { index: number; url: string }[] = [];

    const indexed = $("div.separator[data-index]");
    if (indexed.length === 0) {
      $("div.separator").each((i, page) => {
        const url = $(page).find("a").first().attr("href") || "";
        const abs = this.absUrl(url);
        if (abs) pages.push({ index: i, url: abs });
      });
    } else {
      indexed.each((_, page) => {
        const index = parseInt($(page).attr("data-index") || "0", 10);
        const url = $(page).find("a").first().attr("href") || "";
        const abs = this.absUrl(url);
        if (abs) pages.push({ index, url: abs });
      });
      pages.sort((a, b) => a.index - b.index);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages.map((p) => p.url))],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const path = this.safeDecode(mangaId);
    return `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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
    if (s.includes("ongoing") || s.includes("đang") || s.includes("進行"))
      return "Ongoing";
    if (s.includes("completed") || s.includes("hoàn") || s.includes("完了"))
      return "Completed";
    if (s.includes("hold") || s.includes("tạm") || s.includes("保留"))
      return "Hiatus";
    if (s.includes("cancel") || s.includes("huỷ") || s.includes("キャンセル"))
      return "Cancelled";
    return "Unknown";
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
