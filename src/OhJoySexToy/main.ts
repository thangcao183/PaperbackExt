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

const BASE_URL = "https://www.ohjoysextoy.com";

interface OhJoySexToyMetadata {
  page?: number;
}

class OhJoySexToyInterceptor extends PaperbackInterceptor {
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

type OhJoySexToyImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class OhJoySexToyExtension implements OhJoySexToyImplementation {
  requestManager = new OhJoySexToyInterceptor("main");
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
        id: "latest",
        title: "Latest Comics",
        type: DiscoverSectionType.featured,
      },
      {
        id: "popular",
        title: "All Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "latest") {
      // Latest comics from the homepage (no pagination upstream).
      const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $("#MattsRecentComicsBar > ul > div").each((_, element) => {
        const parsed = this.itemFromThumb($, $(element));
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

    // Popular / all comics, paginated.
    const meta = metadata as OhJoySexToyMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = `${BASE_URL}/category/comic/page/${page}/`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".comicthumbwrap").each((_, element) => {
      const parsed = this.itemFromThumb($, $(element));
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

    const hasNextPage = $(".pagenav-left a").length > 0;
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
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const url = `${BASE_URL}/?s=${encodeURIComponent(titleQuery)}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("h2.post-title").each((_, element) => {
      const link = $(element).find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      const title = link.text().split(" by")[0].trim();
      if (!title) return;
      results.push({
        mangaId,
        imageUrl: "",
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    return { items: results, metadata: undefined };
  }

  private itemFromThumb(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find(".comicarchiveframe > a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = el
      .find(".comicthumbdate")
      .first()
      .text()
      .split(" by")[0]
      .trim();
    const imageUrl = this.imageFromElement(link.find("img").first());
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const ogTitle =
      $('meta[property="og:title"]').first().attr("content") || "";
    const title = ogTitle.split(" by")[0].trim() || this.safeDecode(mangaId);
    const byPart = ogTitle.includes(" by ")
      ? ogTitle.substring(ogTitle.indexOf(" by ") + 4).trim()
      : "";
    const author = byPart.length > 0 ? byPart : undefined;

    const thumbnailUrl = this.absoluteUrl(
      $('meta[property="og:image"]').first().attr("content") || "",
    );

    const genres = $('meta[property="article:section"]')
      .map((_, el) => $(el).attr("content") || "")
      .get()
      .filter((g) => g.length > 0)
      .slice(1);

    const synopsis = this.parseDescription($);

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
        author,
        artist: author,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: "Completed",
        tagGroups,
        shareUrl: url,
      },
    };
  }

  private parseDescription($: CheerioAPI): string {
    const parts: string[] = [];

    const ogDesc =
      $('meta[property="og:description"]').first().attr("content") || "";
    const desc = ogDesc.split(/\s{6,}/)[0].trim();
    if (desc.length > 0) {
      parts.push(`${desc}...`);
    }

    const authorLinks: string[] = [];
    $(".entry div.ui-tabs div a").each((_, el) => {
      const link = $(el);
      const text = link.text().trim();
      const href = this.absoluteUrl(link.attr("href") || "");
      if (text && href) authorLinks.push(`${text}: ${href}`);
    });
    if (authorLinks.length > 0) {
      parts.push(authorLinks.join("\n"));
    }

    parts.push("(Full description and credits in WebView)");
    return parts.join("\n\n");
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const name = $("title").first().text().trim() || "Comic";
    const dateString = $(".post-date").first().text().trim();

    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: 1,
        publishDate: this.parseDate(dateString),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div.comicpane img").each((_, element) => {
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

  private parseDate(dateString: string): Date {
    // Upstream format: MM/dd/yyyy
    const m = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return new Date(0);
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

export const OhJoySexToy = new OhJoySexToyExtension();
