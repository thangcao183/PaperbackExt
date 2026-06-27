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

const BASE_URL = "https://bookwalker.com";

interface BookWalkerMetadata {
  page?: number;
}

class BookWalkerInterceptor extends PaperbackInterceptor {
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

type BookWalkerImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class BookWalkerExtension implements BookWalkerImplementation {
  requestManager = new BookWalkerInterceptor("main");
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
        title: "Popular Manga",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "New Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as BookWalkerMetadata | undefined;
    const page = meta?.page ?? 1;
    const path =
      section.id === "popular"
        ? "/categories/2/?np=0&order=rate"
        : "/categories/2/?np=0&order=release";
    const url = `${BASE_URL}${path}&page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    this.collectListings($).forEach((parsed) => {
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

    return {
      items,
      metadata: items.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as BookWalkerMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const params = [
      `word=${encodeURIComponent(titleQuery)}`,
      "qcat=2",
      "np=0",
      `page=${page}`,
    ];
    const url = `${BASE_URL}/search/?${params.join("&")}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    this.collectListings($).forEach((parsed) => {
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    return {
      items: results,
      metadata: results.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  private collectListings(
    $: CheerioAPI,
  ): { mangaId: string; imageUrl: string; title: string }[] {
    const out: { mangaId: string; imageUrl: string; title: string }[] = [];
    $("a[href*='/series/'], a[href*='/de/']").each((_, element) => {
      const parsed = this.itemFromLink($, $(element));
      if (parsed) out.push(parsed);
    });
    return out;
  }

  private itemFromLink(
    $: CheerioAPI,
    link: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const href = link.attr("href") || "";
    if (!href || !href.includes("/series/")) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const img = link.find("img").first();
    const imageUrl = this.imageFromElement(img);
    const title =
      (link.attr("title") || "").trim() ||
      img.attr("alt")?.trim() ||
      link.text().trim();
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1").first().text().trim() ||
      $("meta[property='og:title']").attr("content")?.trim() ||
      this.safeDecode(mangaId);

    const synopsis =
      $("meta[property='og:description']").attr("content")?.trim() ||
      $("p").first().text().trim() ||
      "";

    const thumbnailUrl =
      this.absoluteUrl(
        $("meta[property='og:image']").attr("content") || "",
      ) || this.imageFromElement($("img").first());

    const genres = $("a[href*='/categories/'], a[href*='/genre/']")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      const uniq = Array.from(new Set(genres));
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: uniq.map((g) => ({
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
    // BookWalker serves its volume/chapter list through a protobuf gRPC API
    // (/api/kyon/kyon.v1.ContentService/Children) that cannot be decoded in the
    // Paperback runtime. We surface the series page itself as a single entry so
    // the extension stays usable for browsing/search; reading requires the app.
    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "View on BookWalker",
        volume: 0,
        chapNum: 1,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // Page images are delivered as E4P-encrypted manifests behind a login and
    // purchase wall, so no readable image URLs can be extracted publicly.
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [],
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

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-original") ||
      img.attr("data-lazy-src") ||
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

export const BookWalker = new BookWalkerExtension();
