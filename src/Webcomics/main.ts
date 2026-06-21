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

const BASE_URL = "https://webcomicsapp.com";
const API_URL = "https://popeye.webcomicsapp.com/api";

const GENRES = [
  "All",
  "Romance",
  "Fantasy",
  "Action",
  "Drama",
  "BL",
  "GL",
  "Comedy",
  "Horror",
  "Mistery",
];

const PAGE_REGEX = /src:(?:\s+)?"([^"]+)"/g;
const UNICODE_REGEX = /\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/g;
const NUXT_PAGE_REGEX = /page:(\d+)/;

interface WebcomicsMetadata {
  page?: number;
  genre?: string;
}

interface ChapterDto {
  index: number;
  is_pay: boolean;
  name: string;
  update_time: number;
}

interface ChapterListResponse {
  data?: {
    list?: ChapterDto[];
    book?: { manga_id?: string; name?: string };
  };
}

class WebcomicsInterceptor extends PaperbackInterceptor {
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

type WebcomicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class WebcomicsExtension implements WebcomicsImplementation {
  requestManager = new WebcomicsInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
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
        title: "Latest Updated",
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
        name: genre,
        searchQuery: {
          title: "",
          metadata: { genre },
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as WebcomicsMetadata | undefined;
    const page = meta?.page ?? 1;

    const sort = section.id === "popular" ? "Popularity" : "Latest_Updated";
    const url = `${BASE_URL}/genres/All/All/${sort}/${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("#All a").each((_, element) => {
      const el = $(element);
      const parsed = this.popularItemFromElement($, el);
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

    const hasNextPage = this.hasNuxtNextPage($);
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
    const titleQuery = (query.title || "").trim();
    const queryMeta = query.metadata as WebcomicsMetadata | undefined;

    if (titleQuery !== "") {
      const url = `${BASE_URL}/search/${this.toPathSegment(titleQuery)}`;
      const $ = await this.fetchCheerio({ url, method: "GET" });

      const results: SearchResultItem[] = [];
      const seen = new Set<string>();
      $(".list-item a").each((_, element) => {
        const el = $(element);
        const href = el.attr("href") || "";
        if (!href) return;
        const mangaId = this.parsePath(href);
        if (!mangaId || seen.has(mangaId)) return;
        seen.add(mangaId);
        const title = el.find(".info-title").first().text().trim();
        const imageUrl = this.imageFromElement(el.find("img").first());
        if (!title) return;
        results.push({
          mangaId,
          imageUrl,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      });

      return { items: results, metadata: undefined };
    }

    // Genre / popularity browsing
    const meta = metadata as WebcomicsMetadata | undefined;
    const page = meta?.page ?? 1;
    const genre = queryMeta?.genre ?? "All";

    const url = `${BASE_URL}/genres/${encodeURIComponent(genre)}/All/Popular/${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("#All a").each((_, element) => {
      const el = $(element);
      const parsed = this.popularItemFromElement($, el);
      if (!parsed) return;
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

    const hasNextPage = this.hasNuxtNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1, genre } : undefined,
    };
  }

  private popularItemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const href = el.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = el.find("h5").first().text().trim();
    if (!title) return undefined;
    const imageUrl = this.imageFromElement(el.find("img[src]").first());
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const info = $(".card-info").first();
    const title =
      info.find("h5").first().text().trim() || this.safeDecode(mangaId);
    const synopsis = info.find(".book-detail > p").first().text().trim();
    const thumbnailUrl = this.imageFromElement(info.find("img").first());

    const genres = info
      .find(".label-tag")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const statusText = $(".chapter-updateDetail").first().text();
    const status = statusText.includes("IDK") ? "Completed" : "Ongoing";

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
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status,
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId).replace(/\/+$/, "");
    const mangaIdParam = slug.substring(slug.lastIndexOf("/") + 1);

    const url = `${API_URL}/chapter/list?manga_id=${encodeURIComponent(mangaIdParam)}`;
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }

    const parsed = JSON.parse(
      Application.arrayBufferToUTF8String(data),
    ) as ChapterListResponse;

    const list = parsed.data?.list ?? [];
    const book = parsed.data?.book ?? {};
    const bookName = book.name ?? "";
    const bookMangaId = book.manga_id ?? mangaIdParam;

    const chapters: Chapter[] = list.map((chapter) => {
      const title = chapter.is_pay ? `🔒 ${chapter.name}` : chapter.name;
      const nameSegment = this.toPathSegment(chapter.name);
      const viewSlug = [
        "view",
        bookName.replace(/\s+/g, "-"),
        String(chapter.index),
        `${bookMangaId}-${nameSegment}`,
      ].join("/");
      const chapterId = this.toSafeId(viewSlug);

      return {
        chapterId,
        sourceManga,
        title,
        volume: 0,
        chapNum: chapter.index,
        publishDate: chapter.update_time
          ? new Date(chapter.update_time)
          : new Date(0),
        langCode: "🇬🇧",
      };
    });

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    let scriptData = "";
    $("script").each((_, element) => {
      const data = $(element).contents().text();
      if (data.includes("__NUXT__") && /src:(?:\s+)?"/.test(data)) {
        scriptData = data;
      }
    });

    const pages: string[] = [];
    if (scriptData) {
      let match: RegExpExecArray | null;
      PAGE_REGEX.lastIndex = 0;
      while ((match = PAGE_REGEX.exec(scriptData)) !== null) {
        const imageUrl = this.absoluteUrl(this.decodeUnicode(match[1]));
        if (imageUrl) pages.push(imageUrl);
      }
    }

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

  private hasNuxtNextPage($: CheerioAPI): boolean {
    let found = false;
    $("script").each((_, element) => {
      if (found) return;
      const data = $(element).contents().text();
      if (!data.includes("__NUXT__")) return;
      found = NUXT_PAGE_REGEX.test(data);
    });
    return found;
  }

  private toPathSegment(value: string): string {
    return value
      .replace(/[!-/:-@[-`{-~]/g, "")
      .replace(/\s+/g, "-");
  }

  private decodeUnicode(value: string): string {
    return value.replace(UNICODE_REGEX, (_m, p1, p2) => {
      const hex = (p1 as string) || (p2 as string);
      return String.fromCharCode(parseInt(hex, 16));
    });
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

export const Webcomics = new WebcomicsExtension();
