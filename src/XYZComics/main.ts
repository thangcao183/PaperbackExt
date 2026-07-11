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

const BASE_URL = "https://xyzcomics.com";

// Prefix used to tag genre chips so tapping one routes to its dedicated tag
// listing instead of a plain title search. Mirrors upstream ArtistTagFilter.
const TAG_GENRE_PREFIX = "tag:";

interface XYZComicsMetadata {
  page?: number;
}

class XYZComicsInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
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
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

type XYZComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class XYZComicsExtension implements XYZComicsImplementation {
  requestManager = new XYZComicsInterceptor("main");
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

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "allsexkomix",
        title: "All Comix",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as XYZComicsMetadata)?.page ?? 1;
    const url =
      page === 1
        ? `${BASE_URL}/${section.id}/`
        : `${BASE_URL}/${section.id}/page/${page}/`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const { items, hasNextPage } = this.parseMangaList($);

    return {
      items: items.map((item) => ({
        type: "simpleCarouselItem",
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        metadata: undefined,
      })),
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as XYZComicsMetadata)?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery.startsWith(TAG_GENRE_PREFIX)) {
      const slug = this.slugify(
        this.safeDecode(titleQuery.slice(TAG_GENRE_PREFIX.length)),
      );
      url =
        page === 1
          ? `${BASE_URL}/tag/${slug}/`
          : `${BASE_URL}/tag/${slug}/page/${page}/`;
    } else {
      const q = encodeURIComponent(titleQuery);
      url =
        page === 1
          ? `${BASE_URL}/?s=${q}`
          : `${BASE_URL}/page/${page}/?s=${q}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const { items, hasNextPage } = this.parseMangaList($);

    return {
      items: items.map((item) => ({
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        metadata: undefined,
      })),
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetchCheerio({
      url: this.mangaUrl(mangaId),
      method: "GET",
    });

    const title =
      $("h1.post-title a, h1.post-title").first().text().trim() ||
      $("title").first().text().trim();
    const thumbnailUrl = this.absoluteUrl(
      $(".pswp-gallery .pswp-gallery__item a[href]").first().attr("href") || "",
    );

    const genres: string[] = [];
    $("a.post-tag-button").each((_, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });

    const tagGroups: TagSection[] =
      genres.length > 0
        ? [
            {
              id: "genres",
              title: "Tags",
              tags: genres.map((g) => ({
                id: `${TAG_GENRE_PREFIX}${this.toSafeId(g)}`,
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis: "",
        contentRating: ContentRating.ADULT,
        status: "Unknown",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter 1",
        volume: 0,
        chapNum: 1,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetchCheerio({
      url: this.chapterUrl(chapter.chapterId),
      method: "GET",
    });

    const pages: string[] = [];
    $(".pswp-gallery .pswp-gallery__item a[href]").each((_, el) => {
      const href = this.absoluteUrl($(el).attr("href") || "");
      if (href) pages.push(href.replace(/ /g, "%20"));
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

  // ---- helpers ----

  private parseMangaList($: CheerioAPI): {
    items: { mangaId: string; title: string; imageUrl: string }[];
    hasNextPage: boolean;
  } {
    const items: { mangaId: string; title: string; imageUrl: string }[] = [];
    $("article.post").each((_, el) => {
      const article = $(el);
      const thumbLink = article.find("figure.post-image a").first();
      const titleEl = article.find("h2.post-title a").first();
      const href = thumbLink.attr("href");
      const title = titleEl.text().trim();
      if (!href || !title) return;
      const img = article.find("figure.post-image img.wp-post-image").first();
      items.push({
        mangaId: this.parsePath(href),
        title,
        imageUrl: img.length ? this.imageFromElement(img) : "",
      });
    });

    const hasNextPage =
      $("a.nextp, .pagenav a.next, a.page-numbers.next, a[rel=next]").length >
      0;
    return { items, hasNextPage };
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    return this.mangaUrl(chapterId);
  }

  private parsePath(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "");
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
    return this.absoluteUrl(src).replace(/ /g, "%20");
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
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

export const XYZComics = new XYZComicsExtension();
