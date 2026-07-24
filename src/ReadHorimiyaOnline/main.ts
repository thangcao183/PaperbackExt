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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://read-horimiya.online";

// This site hosts a single manga ("Horimiya"). Everything resolves to the
// homepage. mangaId is the site-relative path "/".
const MANGA_ID = "/";
const MANGA_TITLE = "Horimiya";

class ReadHorimiyaOnlineInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
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

type ReadHorimiyaOnlineImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ReadHorimiyaOnlineExtension
  implements ReadHorimiyaOnlineImplementation
{
  requestManager = new ReadHorimiyaOnlineInterceptor("main");
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
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const manga = await this.parseManga();
    return {
      items: [
        {
          type: "simpleCarouselItem",
          mangaId: MANGA_ID,
          imageUrl: manga.thumbnailUrl,
          title: manga.title,
          metadata: undefined,
        },
      ],
      metadata: undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    // Single-manga site: surface the one title unless a query clearly excludes
    // it.
    const titleQuery = (query.title || "").trim().toLowerCase();
    if (titleQuery && !MANGA_TITLE.toLowerCase().includes(titleQuery)) {
      return { items: [], metadata: undefined };
    }
    const manga = await this.parseManga();
    return {
      items: [
        {
          mangaId: MANGA_ID,
          imageUrl: manga.thumbnailUrl,
          title: manga.title,
          subtitle: undefined,
          metadata: undefined,
        },
      ],
      metadata: undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const manga = await this.parseManga();
    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.title,
        secondaryTitles: [],
        thumbnailUrl: manga.thumbnailUrl,
        synopsis: manga.description,
        contentRating: ContentRating.EVERYONE,
        status: "Unknown",
        tagGroups: [],
        shareUrl: `${BASE_URL}/`,
      },
    };
  }

  private async parseManga(): Promise<{
    title: string;
    thumbnailUrl: string;
    description: string;
  }> {
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });
    const thumbnailUrl = this.imageFromElement(
      $("ul.wp-block-gallery li.blocks-gallery-item img").first(),
    );
    const description = $("p").first().text().trim();
    return { title: MANGA_TITLE, thumbnailUrl, description };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });

    const rows: { chapterId: string; title: string }[] = [];
    $("#Chapters_List ul li ul li a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const title = el.text().trim();
      rows.push({ chapterId: this.parsePath(href), title });
    });

    const total = rows.length;
    return rows.map((row, index) => ({
      chapterId: row.chapterId,
      sourceManga,
      title: row.title,
      volume: 0,
      chapNum: total - index,
      publishDate: new Date(0),
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div.separator a > img").each((_, element) => {
      const el = $(element);
      const src = el.attr("data-lazy-src") || el.attr("src") || "";
      if (!src) return;
      pages.push(this.absoluteUrl(src).replace(/ /g, "%20"));
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(_mangaId: string): string {
    return `${BASE_URL}/`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-lazy-src") ||
      img.attr("data-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    return this.absoluteUrl(src).replace(/ /g, "%20");
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

export const ReadHorimiyaOnline = new ReadHorimiyaOnlineExtension();
