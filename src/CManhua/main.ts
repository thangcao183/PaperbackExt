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
  MangaProviding,
  Metadata,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://cmanhua.com";

const SORT_UPDATE_TIME = "0";
const SORT_TOP_VIEWS = "2";

const CHAPTER_NUMBER_REGEX = /chapter\s*([0-9]+(?:\.[0-9]+)?)/i;
const CHAPTER_TOKEN_REGEX = /var\s+ts\s*=\s*"([^"]+)"/;

// Curated subset of upstream genres, used to drive the genre discover section
// and the genre-filtered search. Each entry maps a display title to its spec id.
const GENRES: { title: string; id: string }[] = [
  { title: "Action", id: "66d02d130631ac1f64248dbb" },
  { title: "Adaptation", id: "66d055410631ac1f642a5c96" },
  { title: "Adult", id: "66d3439e0631ba299492391b" },
  { title: "Adventure", id: "66d02d130631ac1f64248dbc" },
  { title: "Comedy", id: "66d02d130631ac1f64248dbd" },
  { title: "Crime", id: "66d1e88c0631ac06a8bc9841" },
  { title: "Cultivation", id: "68e8c65b0631ac1560d49631" },
  { title: "Drama", id: "66d01d560631ac1f642312ef" },
  { title: "Ecchi", id: "66d347ad0631bd29944d4b07" },
  { title: "Fantasy", id: "66d01d570631ac1f642312f0" },
  { title: "Full Color", id: "66d2dba10631ac29946b9573" },
  { title: "Game", id: "66f0f9910631ac2094730f65" },
  { title: "Gender Bender", id: "66d300bf0631ac2994726b5e" },
  { title: "Harem", id: "66d055410631ac1f642a5c97" },
  { title: "Historical", id: "66d01d570631ac1f642312f1" },
  { title: "Horror", id: "66d352c70631be2994fc6b5d" },
  { title: "Isekai", id: "66d01d570631ac1f642312f2" },
  { title: "Josei", id: "66d1cae50631ac06a8b89af7" },
  { title: "Magic", id: "66d16fb00631ac1f644c8c1e" },
  { title: "Manhua", id: "66d089940631ac1f642f2cd5" },
  { title: "Manhwa", id: "66d02d130631ac1f64248dbe" },
  { title: "Martial Arts", id: "66d06cc70631ac1f642c3e9f" },
  { title: "Mature", id: "66d3439e0631ba299492391c" },
  { title: "Mecha", id: "66d83fc20631ac0bfc9caeda" },
  { title: "Murim", id: "66dfd50d0631ac1464927f09" },
  { title: "Mystery", id: "66d1e4390631ac06a8bbfcd9" },
  { title: "Psychological", id: "66d0ab580631ac1f6432aeaa" },
  { title: "Reincarnation", id: "66d139250631ac1f6440d6cc" },
  { title: "Romance", id: "66d01d570631ac1f642312f3" },
  { title: "School Life", id: "66d07c3a0631ac1f642d7c51" },
  { title: "Seinen", id: "66d1c77d0631ac06a8b7feb4" },
  { title: "Shoujo", id: "66d01d570631ac1f642312f4" },
  { title: "Shounen", id: "66d045090631ac1f64279346" },
  { title: "Slice of Life", id: "66d2afd30631ac2994648de9" },
  { title: "Smut", id: "66d343830631ba2994923827" },
  { title: "Supernatural", id: "66d045090631ac1f64279347" },
  { title: "System", id: "66f0f9910631ac2094730f66" },
  { title: "Thriller", id: "66d315d80631ac299476fc45" },
  { title: "Time Travel", id: "66d11bea0631ac1f643e157a" },
  { title: "Tragedy", id: "66d0d5ac0631ac1f64377cdc" },
  { title: "Webtoon", id: "66d2d39f0631ac29946a43e3" },
  { title: "Wuxia", id: "66f0efa10631ac2094723e37" },
  { title: "Xianxia", id: "68de070e0631ac28c0b33e52" },
  { title: "Xuanhuan", id: "68e4d2980631ac10f4d7103a" },
  { title: "Yaoi", id: "68da064c0631ac14d06a8648" },
  { title: "Yuri", id: "66ea188e0631ac2264610151" },
  { title: "Zombie", id: "691ec1920631ac2d8c96147a" },
];

interface CManhuaMetadata {
  page?: number;
  genre?: string;
}

class CManhuaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

type CManhuaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class CManhuaExtension implements CManhuaImplementation {
  requestManager = new CManhuaInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

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
        id: "popular",
        title: "Top Views",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "genres",
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const items: DiscoverSectionItem[] = GENRES.map((genre) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: genre.id },
        },
        name: genre.title,
        metadata: { genre: genre.id },
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as CManhuaMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? SORT_TOP_VIEWS : SORT_UPDATE_TIME;
    const url = this.listUrl({ page, sort });
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    this.parseMangaList($).forEach((parsed) => {
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($, page);
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as CManhuaMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as CManhuaMetadata | undefined;
    const genre = meta?.genre ?? queryMeta?.genre ?? "";

    let url: string;
    if (titleQuery !== "") {
      url = this.searchUrl(titleQuery, page);
    } else {
      url = this.listUrl({ page, sort: SORT_UPDATE_TIME, genres: genre });
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    this.parseMangaList($).forEach((parsed) => {
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($, page);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1, genre } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1.title-detail").first().text().trim() || this.safeDecode(mangaId);
    const author = $("li.author p.col-xs-8 a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((a) => a.length > 0)
      .join(", ");
    const statusText = $("li.status p.col-xs-8").first().text();
    const synopsis = $("#descript").first().text().trim();
    const thumbnailUrl = this.imageFromElement(
      $("div.col-image img").first(),
    );

    const genres = $("li.kind p.col-xs-8 a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

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
        thumbnailUrl,
        author: author || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
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
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    $("#listchap li.row").each((_, element) => {
      const el = $(element);
      const link = el.find("div.chapter a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = link.text().trim();
      const dateStr = el.find("time[datetime]").first().attr("datetime") || "";

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseDate(dateStr),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url: chapterUrl, method: "GET" });

    let encoded = "";
    $("script").each((_, element) => {
      if (encoded) return;
      const data = $(element).html() || "";
      const m = data.match(CHAPTER_TOKEN_REGEX);
      if (m) encoded = m[1];
    });
    if (!encoded) {
      throw new Error("Unable to find chapter token");
    }

    const pages = await this.fetchChapterPages(encoded, chapterUrl);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Request builders
  // ----------------------------------------------------------------

  private listUrl(opts: {
    page: number;
    sort: string;
    status?: string;
    minChapters?: string;
    gender?: string;
    genres?: string;
  }): string {
    const status = opts.status ?? "-1";
    const minChapters = opts.minChapters ?? "0";
    const gender = opts.gender ?? "-1";
    const params: string[] = [];
    params.push(`status=${encodeURIComponent(status)}`);
    params.push(`sort=${encodeURIComponent(opts.sort)}`);
    params.push(`chapter=${encodeURIComponent(minChapters)}`);
    params.push(`gender=${encodeURIComponent(gender)}`);
    if (opts.genres && opts.genres.length > 0) {
      params.push(`spec=${encodeURIComponent(opts.genres)}`);
    }
    return `${BASE_URL}/danhsach/P${opts.page}/index.html?${params.join("&")}`;
  }

  private searchUrl(query: string, page: number): string {
    const slug = encodeURIComponent(query.trim());
    const pageSegment = page > 1 ? `/P${page}` : "";
    return `${BASE_URL}/${slug}${pageSegment}/tim-kiem.html`;
  }

  // ----------------------------------------------------------------
  // Pages API (POST to /Service.asmx/getchapter)
  // ----------------------------------------------------------------

  private async fetchChapterPages(
    encoded: string,
    referer: string,
  ): Promise<string[]> {
    const request: Request = {
      url: `${BASE_URL}/Service.asmx/getchapter`,
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-requested-with": "XMLHttpRequest",
        referer,
      },
      body: JSON.stringify({ enc: encoded }),
    };

    const [, data] = await Application.scheduleRequest(request);
    const body = Application.arrayBufferToUTF8String(data);
    const payload = this.extractChapterPayload(body);

    const code = parseInt(payload.trim(), 10);
    if (!Number.isNaN(code) && String(code) === payload.trim()) {
      throw new Error(this.errorMessage(code));
    }

    const dom = htmlparser2.parseDocument(payload);
    const $ = cheerio.load(dom);
    const pages: string[] = [];
    $("img").each((_, element) => {
      const src = $(element).attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });
    return pages;
  }

  private extractChapterPayload(body: string): string {
    let trimmed = body.trim();
    if (trimmed.startsWith("﻿")) {
      trimmed = trimmed.slice(1).trim();
    }
    if (trimmed === "") {
      throw new Error("Failed to load chapter pages.");
    }
    if (trimmed.startsWith("<") || /<img/i.test(trimmed)) {
      return trimmed;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(this.errorMessageFromBody(trimmed));
    }

    if (typeof parsed === "string") {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const data = obj["d"] ?? obj["data"] ?? obj["html"];
      if (typeof data === "string") return data;
    }
    throw new Error(this.errorMessageFromBody(trimmed));
  }

  private errorMessageFromBody(body: string): string {
    const code = parseInt(body.trim(), 10);
    if (!Number.isNaN(code) && String(code) === body.trim()) {
      return this.errorMessage(code);
    }
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        const err = (parsed as Record<string, unknown>)["error"];
        if (typeof err === "string") return err;
      }
    } catch {
      // ignore
    }
    return "Failed to load chapter pages. Unknown error.";
  }

  private errorMessage(code: number): string {
    switch (code) {
      case 3:
        return "You do not have enough coins to unlock this chapter.";
      case -1:
        return "Chapter does not exist.";
      case -2:
        return "Chapter token expired.";
      case -3:
        return "Invalid parameters.";
      case -4:
        return "Login required to access this chapter.";
      case -5:
        return "Account is banned or does not exist.";
      default:
        return `Failed to load chapter pages. Unknown error (code: ${code}).`;
    }
  }

  // ----------------------------------------------------------------
  // List parsing
  // ----------------------------------------------------------------

  private parseMangaList(
    $: CheerioAPI,
  ): { mangaId: string; imageUrl: string; title: string }[] {
    const results: { mangaId: string; imageUrl: string; title: string }[] = [];
    $("ul.lst_story li.item").each((_, element) => {
      const el = $(element);
      let link = el.find("h3 a").first();
      if (link.length === 0) {
        link = el.find("a[itemprop=url]").first();
      }
      const href = link.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId) return;
      const title = link.text().trim();
      const imageUrl = this.imageFromElement(el.find("img").first());
      results.push({ mangaId, imageUrl, title });
    });
    return results;
  }

  private hasNextPage($: CheerioAPI, page: number): boolean {
    let maxPage = 0;
    $("li.list-pager a").each((_, el) => {
      const n = parseInt($(el).text().trim(), 10);
      if (!Number.isNaN(n) && n > maxPage) maxPage = n;
    });
    if (maxPage === 0) return false;
    return page < maxPage;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
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

  private parseChapterNumber(name: string): number {
    const m = name.match(CHAPTER_NUMBER_REGEX);
    return m ? parseFloat(m[1]) : -1;
  }

  private parseDate(dateStr: string): Date {
    const s = (dateStr || "").trim();
    if (!s) return new Date(0);
    const t = Date.parse(s);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    return this.absoluteUrl(src);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase().trim();
    if (s === "on going" || s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
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
}

export const CManhua = new CManhuaExtension();
