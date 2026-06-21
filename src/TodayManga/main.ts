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

const BASE_URL = "https://todaymanga.com";

interface TodayMangaMetadata {
  page?: number;
}

const GENRES: { title: string; slug: string }[] = [
  { title: "Action", slug: "action" },
  { title: "Adventure", slug: "adventure" },
  { title: "Comedy", slug: "comedy" },
  { title: "Drama", slug: "drama" },
  { title: "Ecchi", slug: "ecchi" },
  { title: "Fantasy", slug: "fantasy" },
  { title: "Gender Bender", slug: "gender-bender" },
  { title: "Harem", slug: "harem" },
  { title: "Historical", slug: "historical" },
  { title: "Horror", slug: "horror" },
  { title: "Martial Arts", slug: "martial-arts" },
  { title: "Mature", slug: "mature" },
  { title: "Music", slug: "music" },
  { title: "Mystery", slug: "mystery" },
  { title: "One Shot", slug: "one-shot" },
  { title: "Psychological", slug: "psychological" },
  { title: "Reverse Harem", slug: "reverse-harem" },
  { title: "Romance", slug: "romance" },
  { title: "School Life", slug: "school-life" },
  { title: "Sci fi", slug: "sci-fi" },
  { title: "Seinen", slug: "seinen" },
  { title: "Shoujo", slug: "shoujo" },
  { title: "Shounen Ai", slug: "shounen-ai" },
  { title: "Shounen", slug: "shounen" },
  { title: "Slice Of Life", slug: "slice-of-life" },
  { title: "Sports", slug: "sports" },
  { title: "Supernatural", slug: "supernatural" },
  { title: "Tragedy", slug: "tragedy" },
  { title: "Vampire", slug: "vampire" },
  { title: "Webtoons", slug: "webtoons" },
];

class TodayMangaInterceptor extends PaperbackInterceptor {
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

type TodayMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class TodayMangaExtension implements TodayMangaImplementation {
  requestManager = new TodayMangaInterceptor("main");
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
        id: "most-popular",
        title: "Most Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "recent",
        title: "Recent Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "trending",
        title: "Trending This Week",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "highest-rated",
        title: "Highest Rated",
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
          metadata: { genre: g.slug },
        },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as TodayMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = this.addPage(`${BASE_URL}/category/${section.id}`, page);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const parsed = this.parseListing($);
    const items: DiscoverSectionItem[] = parsed.map((m) => ({
      type:
        section.id === "most-popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));

    const hasNextPage = this.hasNextPage($);
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as TodayMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as { genre?: string } | undefined;

    let url: string;
    if (queryMeta?.genre) {
      url = `${BASE_URL}/genre/${queryMeta.genre}`;
    } else if (titleQuery !== "") {
      url = `${BASE_URL}/search?q=${encodeURIComponent(titleQuery)}`;
    } else {
      url = `${BASE_URL}/category/most-popular`;
    }
    url = this.addPage(url, page);

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const parsed = this.parseListing($);
    const results: SearchResultItem[] = parsed.map((m) => ({
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Listing parsing (popular + latest layouts)
  // ----------------------------------------------------------------

  private parseListing(
    $: CheerioAPI,
  ): { mangaId: string; imageUrl: string; title: string }[] {
    const out: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();

    // Popular / category layout
    $("section div.serie").each((_, element) => {
      const el = $(element);
      const link = el.find("a[href]").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      const imageUrl = this.imageFromElement(el.find("img").first());
      const title = el.find("h2").first().text().trim();
      if (!title) return;
      seen.add(mangaId);
      out.push({ mangaId, imageUrl, title });
    });

    if (out.length > 0) return out;

    // Latest / list layout
    $("ul.series > li").each((_, element) => {
      const el = $(element);
      const link = el.find("a[title][href]").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      const imageUrl = this.imageFromElement(el.find("img").first());
      const title = link.attr("title")?.trim() || "";
      if (!title) return;
      seen.add(mangaId);
      out.push({ mangaId, imageUrl, title });
    });

    return out;
  }

  private hasNextPage($: CheerioAPI): boolean {
    return $(".pagination > ul > li.active + li:has(a)").length > 0;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const serie = $(".serie").first();
    const title =
      serie.find("h1").first().text().trim() || this.safeDecode(mangaId);
    const thumbnailUrl = this.imageFromElement(serie.find("img").first());

    const genres = serie
      .find(".serie-info-head .tags > .tag-item")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const authors = serie
      .find(".authors a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((a) => a.length > 0);

    const statusText = serie.find("li:contains(status) span").first().text();

    const synopsis = this.parseSynopsis($);

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
        author: authors.join(", ") || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  private parseSynopsis($: CheerioAPI): string {
    const summary = $(".serie-summary").first();
    if (summary.length === 0) return "";
    const parts: string[] = [];
    summary.contents().each((_, node) => {
      if (node.type === "text") {
        parts.push(node.data);
      } else if (node.type === "tag" && node.name === "br") {
        parts.push("\n");
      }
    });
    let text = parts.join("");
    const styled = summary.find("div[style]").first();
    if (styled.length > 0) {
      text += "\n\n" + styled.text();
    }
    return text.trim();
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = `${this.mangaUrl(sourceManga.mangaId)}/chapter-list`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const elements = $("ul.chapters-list > li").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = link.text().trim();
      const dateText = el.find(".subtitle").first().text().trim();

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name, elements.length - index),
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const collected: { index: number; url: string }[] = [];
    $(".chapter-content > img[data-index]").each((_, element) => {
      const el = $(element);
      const idx = parseInt(el.attr("data-index") || "0", 10);
      const src = this.imageFromElement(el);
      if (src) collected.push({ index: isNaN(idx) ? 0 : idx, url: src });
    });
    collected.sort((a, b) => a.index - b.index);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: collected.map((c) => c.url),
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private addPage(url: string, page: number): string {
    if (page <= 1) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}page=${page}`;
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

  private parseChapterNumber(name: string, fallback: number): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date(0);
    if (dateText.toLowerCase().includes("ago")) {
      return this.parseRelativeDate(dateText);
    }
    const m = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      return new Date(
        Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)),
      );
    }
    return new Date(0);
  }

  private parseRelativeDate(text: string): Date {
    const lower = text.toLowerCase();
    const first = lower.split(" ")[0]?.replace("one", "1").replace("a", "1");
    const amount = first ? parseInt(first, 10) : NaN;
    if (isNaN(amount)) return new Date(0);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = now.getTime();
    const sec = 1000;
    const min = 60 * sec;
    const hour = 60 * min;
    const day = 24 * hour;

    if (lower.includes("second")) return new Date(d - amount * sec);
    if (lower.includes("minute")) return new Date(d - amount * min);
    if (lower.includes("hour")) return new Date(d - amount * hour);
    if (lower.includes("day")) return new Date(d - amount * day);
    if (lower.includes("week")) return new Date(d - amount * 7 * day);
    if (lower.includes("month")) return new Date(d - amount * 30 * day);
    if (lower.includes("year")) return new Date(d - amount * 365 * day);
    return new Date(0);
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-lazy-src") ||
      img.attr("data-src") ||
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
    if (s === "complete" || s.includes("complete")) return "Completed";
    if (s === "on going" || s.includes("on going") || s.includes("ongoing"))
      return "Ongoing";
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

export const TodayManga = new TodayMangaExtension();
