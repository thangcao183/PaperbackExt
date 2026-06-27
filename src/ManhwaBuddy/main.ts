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

const BASE_URL = "https://manhwabuddy.com";

interface ManhwaBuddyMetadata {
  page?: number;
  genre?: string;
}

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const GENRES: { id: string; title: string }[] = [
  { id: "action", title: "Action" },
  { id: "romance", title: "Romance" },
  { id: "drama", title: "Drama" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "mature", title: "Mature" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "school-life", title: "School Life" },
  { id: "smut", title: "Smut" },
  { id: "isekai", title: "Isekai" },
  { id: "thriller", title: "Thriller" },
  { id: "crime", title: "Crime" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "horror", title: "Horror" },
  { id: "mecha", title: "Mecha" },
  { id: "medical", title: "Medical" },
  { id: "sports", title: "Sports" },
];

class ManhwaBuddyInterceptor extends PaperbackInterceptor {
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

type ManhwaBuddyImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ManhwaBuddyExtension implements ManhwaBuddyImplementation {
  requestManager = new ManhwaBuddyInterceptor("main");
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
      const items: DiscoverSectionItem[] = GENRES.map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: g.id } as Metadata,
        },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === "popular") {
      const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $(".item-move").each((_, element) => {
        const el = $(element);
        const parsed = this.itemFromElement($, el, "h3");
        if (!parsed || seen.has(parsed.mangaId)) return;
        seen.add(parsed.mangaId);
        items.push({
          type: "featuredCarouselItem",
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          metadata: undefined,
        });
      });
      return { items, metadata: undefined };
    }

    // latest
    const meta = metadata as ManhwaBuddyMetadata | undefined;
    const page = meta?.page ?? 1;
    const $ = await this.fetchCheerio({
      url: `${BASE_URL}/page/${page}`,
      method: "GET",
    });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".latest-list .latest-item").each((_, element) => {
      const el = $(element);
      const parsed = this.itemFromElement($, el, "h4");
      if (!parsed || seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type: "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });
    const hasNextPage = $(".next").length > 0;
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ManhwaBuddyMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as ManhwaBuddyMetadata | undefined;

    let url: string;
    if (titleQuery.length > 0) {
      url = `${BASE_URL}/search?s=${encodeURIComponent(titleQuery)}&page=${page}`;
    } else {
      const genre = queryMeta?.genre || "action";
      url = `${BASE_URL}/genre/${genre}/page/${page}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $(".latest-list .latest-item").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      const imageUrl = this.imageFromElement(el.find("img").first());
      const title =
        link.attr("title")?.trim() ||
        el.find("h4").first().text().trim() ||
        el.find("h3").first().text().trim();
      if (!title) return;
      seen.add(mangaId);
      results.push({
        mangaId,
        imageUrl,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $(".next").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
    titleSelector: string,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find("a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const imageUrl = this.imageFromElement(el.find("img").first());
    const title =
      el.find(titleSelector).first().text().trim() ||
      link.attr("title")?.trim() ||
      "";
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const info = $(".main-info-right").first();

    const author = info.find("li:contains(Author) a").first().text().trim();
    const artist = info.find("li:contains(Artist) a").first().text().trim();
    const statusText = info
      .find("li:contains(Status) span")
      .first()
      .text()
      .trim();

    const genres = info
      .find("li:contains(Genres) a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const synopsis = $(".short-desc-content p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join("\n");

    const title =
      $(".main-info-right h1, .main-info-right h2, h1.title")
        .first()
        .text()
        .trim() ||
      $("img.cover, .main-info-left img").first().attr("alt")?.trim() ||
      this.safeDecode(mangaId);

    const thumbnailUrl = this.imageFromElement(
      $(".main-info-left img, .manga-cover img, img.cover").first(),
    );

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
        artist: artist || undefined,
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
    const elements = $(".chapter-list a").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find(".chapter-name").first().text().trim();
      const dateText = el.find(".ct-update").first().text().trim();

      chapters.push({
        chapterId,
        sourceManga,
        title: name || `Chapter ${elements.length - index}`,
        volume: 0,
        chapNum: this.parseChapterNumber(name) || elements.length - index,
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $(".loading").each((_, element) => {
      const src =
        $(element).attr("src") || $(element).attr("data-src") || "";
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
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseDate(text: string): Date {
    const t = (text || "").trim();
    if (!t) return new Date(0);
    // Upstream format: "dd MMMM yyyy" e.g. "05 January 2024"
    const m = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = MONTHS[m[2].toLowerCase()];
      const year = parseInt(m[3], 10);
      if (month !== undefined) {
        return new Date(Date.UTC(year, month, day));
      }
    }
    const parsed = Date.parse(t);
    if (!isNaN(parsed)) return new Date(parsed);
    return new Date(0);
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
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("complete")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
    return "Unknown";
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

export const ManhwaBuddy = new ManhwaBuddyExtension();
