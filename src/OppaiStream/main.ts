import {
  AdvancedSearchForm,
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
import { OppaiStreamSearchForm, OppaiStreamSearchMeta } from "./forms";

const BASE_URL = "https://read.oppai.stream";
const CDN_URL = "https://myspacecat.pictures";
const SEARCH_LIMIT = 36;

interface OppaiStreamMetadata {
  page?: number;
}

class OppaiStreamInterceptor extends PaperbackInterceptor {
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

type OppaiStreamImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class OppaiStreamExtension implements OppaiStreamImplementation {
  requestManager = new OppaiStreamInterceptor("main");
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
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: OppaiStreamSearchMeta }
      | undefined;
    return new OppaiStreamSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as OppaiStreamMetadata | undefined;
    const page = meta?.page ?? 1;

    const order = section.id === "popular" ? "views" : "uploaded";
    const url = this.buildSearchUrl("", order, [], [], page);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const elements = $("div.in-grid > a");
    const items: DiscoverSectionItem[] = [];
    elements.each((_, element) => {
      const parsed = this.parseListItem($, $(element));
      if (!parsed) return;
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

    const hasNextPage = elements.length >= SEARCH_LIMIT;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as OppaiStreamMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: OppaiStreamSearchMeta } | undefined
    )?.searchMeta;

    const order = searchMeta?.order?.[0] ?? "";
    const includeGenres = searchMeta?.includeGenres ?? [];
    const excludeGenres = searchMeta?.excludeGenres ?? [];

    const url = this.buildSearchUrl(
      titleQuery,
      order,
      includeGenres,
      excludeGenres,
      page,
    );
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const elements = $("div.in-grid > a");
    const results: SearchResultItem[] = [];
    elements.each((_, element) => {
      const parsed = this.parseListItem($, $(element));
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = elements.length >= SEARCH_LIMIT;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    text: string,
    order: string,
    includeGenres: string[],
    excludeGenres: string[],
    page: number,
  ): string {
    const params: string[] = [];
    params.push(`text=${encodeURIComponent(text)}`);
    if (order) params.push(`order=${encodeURIComponent(order)}`);
    if (includeGenres.length > 0) {
      params.push(`genres=${encodeURIComponent(includeGenres.join(","))}`);
    }
    if (excludeGenres.length > 0) {
      params.push(`blacklist=${encodeURIComponent(excludeGenres.join(","))}`);
    }
    params.push(`page=${page}`);
    params.push(`limit=${SEARCH_LIMIT}`);
    return `${BASE_URL}/api-search.php?${params.join("&")}`;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const thumbnailUrl = this.absoluteUrl(
      $(".cover-img").first().attr("src") || "",
    );

    const info = $(".manhwa-info-in").first();
    const h1 = info.find("h1").first();
    const title = h1.text().split("By")[0].trim() || this.safeDecode(mangaId);
    const author = info.find("a.red").first().text().trim();
    const genres = info
      .find(".genres h5")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
    const synopsis = info.find(".description").first().text().trim();

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
        artist: author || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: "Unknown",
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
    $(".sort-chapters > a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const name = el.find("div > h4").first().text().trim();
      const dateText = el.find("div > h6").first().text().trim();

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseRelativeDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.chapterUrl(chapter.chapterId);
    const slug = this.queryParam(chapterUrl, "m");
    const chapNo = this.queryParam(chapterUrl, "c");

    const url = `${CDN_URL}/manhwa/im.php?f-m=${encodeURIComponent(
      slug,
    )}&c=${encodeURIComponent(chapNo)}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("img").each((_, element) => {
      const src = $(element).attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });

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
  // Helpers
  // ----------------------------------------------------------------

  private parseListItem(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; title: string; imageUrl: string } | undefined {
    const title = el.find("h3.man-title").first().text().trim();
    let href = el.attr("href") || "";
    if (!href || !title) return undefined;
    if (href.includes("/fw?to=")) {
      href = this.safeDecode(href.split("/fw?to=")[1] || "");
    }
    const imageUrl = this.absoluteUrl(
      el.find("img.read-cover").first().attr("src") || "",
    );
    return { mangaId: this.parsePath(href), title, imageUrl };
  }

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
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/#.*$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
  }

  private queryParam(url: string, key: string): string {
    const match = url.match(new RegExp(`[?&]${key}=([^&#]*)`));
    return match ? this.safeDecode(match[1]) : "";
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
    const match = name.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : -1;
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseRelativeDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    const num = parseInt(dateText.split(" ")[0].trim(), 10);
    if (isNaN(num)) return new Date(0);
    const now = new Date();
    const lower = dateText.toLowerCase();
    if (lower.includes("second")) now.setSeconds(now.getSeconds() - num);
    else if (lower.includes("minute")) now.setMinutes(now.getMinutes() - num);
    else if (lower.includes("hour")) now.setHours(now.getHours() - num);
    else if (lower.includes("day")) now.setDate(now.getDate() - num);
    else if (lower.includes("week")) now.setDate(now.getDate() - num * 7);
    else if (lower.includes("month")) now.setMonth(now.getMonth() - num);
    else if (lower.includes("year"))
      now.setFullYear(now.getFullYear() - num);
    else return new Date(0);
    return now;
  }

  // ----------------------------------------------------------------
  // Cloudflare + fetch
  // ----------------------------------------------------------------

  async cloudflareBypassCompleted(
    _request: Request,
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

export const OppaiStream = new OppaiStreamExtension();
