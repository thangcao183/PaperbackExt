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

const BASE_URL = "https://xlecx.one";

interface XlecXMetadata {
  page?: number;
}

interface JsonLdBook {
  datePublished?: string;
  dateModified?: string;
  image?: string[];
}

interface JsonLdDto {
  "@graph"?: JsonLdBook[];
}

class XlecXInterceptor extends PaperbackInterceptor {
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

type XlecXImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class XlecXExtension implements XlecXImplementation {
  requestManager = new XlecXInterceptor("main");
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

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as XlecXMetadata | undefined;
    const page = meta?.page ?? 1;
    const url =
      section.id === "popular"
        ? this.listUrl("sort=news_read/order=desc", page)
        : this.listUrl("sort=date/order=desc", page);

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("#dle-content > a.thumb").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
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

    const hasNextPage = this.hasNextPage($);
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
    const meta = metadata as XlecXMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const params: string[] = [
      "do=search",
      "subaction=search",
      `search_start=${page}`,
      "full_search=0",
      `story=${encodeURIComponent(titleQuery)}`,
    ];
    const url = `${BASE_URL}/index.php?${params.join("&")}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    $("#dle-content > a.thumb").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const href = el.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const img = el.find("img").first();
    const title = (img.attr("alt") || "").trim();
    const imageUrl = this.imageFromElement(img);
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
    const artist = this.subInfoLinks($, "Artist:");
    const author = this.subInfoLinks($, "Group:");
    const genreText = this.subInfoLinks($, "Tags:");
    const thumbnailUrl = this.absoluteUrl(
      $("meta[property=og:image]").first().attr("content") || "",
    );

    const tagGroups: TagSection[] = [];
    const genres = genreText
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    if (genres.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
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
        synopsis: "",
        contentRating: ContentRating.MATURE,
        status: "Completed",
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

    const dto = this.parseJsonLd($);
    const book = dto?.["@graph"]?.[0];
    const dateStr = book?.dateModified || book?.datePublished;
    const publishDate = this.parseDate(dateStr);

    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate,
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.mangaUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];

    // 'Full size' tab
    $("#content-2 > .imagegall23 > img").each((_, element) => {
      const el = $(element);
      const src = el.attr("data-src") || el.attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });
    if (pages.length > 0) {
      return this.buildDetails(chapter, pages);
    }

    // Plain
    $(".page__text a:has(img)").each((_, element) => {
      const href = $(element).attr("href") || "";
      if (href) pages.push(this.absoluteUrl(href));
    });
    if (pages.length > 0) {
      return this.buildDetails(chapter, pages);
    }

    // 'Thumb' tab
    $("#content-1 > .imagegall23 > img").each((_, element) => {
      const el = $(element);
      const src = el.attr("data-src") || el.attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });
    if (pages.length > 0) {
      return this.buildDetails(chapter, pages);
    }

    // JSON-LD fallback
    const dto = this.parseJsonLd($);
    const book = dto?.["@graph"]?.[0];
    for (const imageUrl of book?.image ?? []) {
      if (imageUrl) pages.push(this.absoluteUrl(imageUrl));
    }

    return this.buildDetails(chapter, pages);
  }

  private buildDetails(chapter: Chapter, pages: string[]): ChapterDetails {
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

  private listUrl(filter: string, page: number): string {
    const pageStr = page > 1 ? `page/${page}/` : "";
    return `${BASE_URL}/f/${filter}/${pageStr}`;
  }

  private hasNextPage($: CheerioAPI): boolean {
    let found = false;
    $("#pagination > .pagination__pages > a").each((_, element) => {
      if ($(element).text().includes("Next")) found = true;
    });
    return found;
  }

  private subInfoLinks($: CheerioAPI, label: string): string {
    const texts: string[] = [];
    $(".page__subinfo-item > div:not([class])").each((_, element) => {
      const el = $(element);
      if (!el.text().includes(label)) return;
      el.nextAll("a").each((_i, a) => {
        const t = $(a).text().trim();
        if (t) texts.push(t);
      });
    });
    return texts.join(", ");
  }

  private parseJsonLd($: CheerioAPI): JsonLdDto | undefined {
    const script = $("script[type=application/ld+json]").first().text().trim();
    if (!script) return undefined;
    try {
      return JSON.parse(script) as JsonLdDto;
    } catch {
      return undefined;
    }
  }

  private parseDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date(0);
    const t = Date.parse(dateStr);
    if (Number.isNaN(t)) return new Date(0);
    return new Date(t);
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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

export const XlecX = new XlecXExtension();
