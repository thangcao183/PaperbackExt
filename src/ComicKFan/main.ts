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
import { ComicKFanSearchForm, ComicKFanSearchMeta } from "./forms";

const BASE_URL = "https://comickfan.com";

interface ComicKFanMetadata {
  page?: number;
}

interface ComicKFanChapterDto {
  hash_id: string;
  chapter: string;
  title?: string;
  group_names?: string[];
  published_at?: string;
  created_at?: string;
}

interface ComicKFanChapterListResponseDto {
  data?: ComicKFanChapterDto[];
}

class ComicKFanInterceptor extends PaperbackInterceptor {
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

type ComicKFanImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ComicKFanExtension implements ComicKFanImplementation {
  requestManager = new ComicKFanInterceptor("main");
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
      | { searchMeta?: ComicKFanSearchMeta }
      | undefined;
    return new ComicKFanSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as ComicKFanMetadata | undefined;
    const page = meta?.page ?? 1;

    const sort = section.id === "popular" ? "rating" : "latest";
    const url = this.buildSearchUrl({ sort }, "", page);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    this.eachSearchItem($, (item) => {
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        metadata: undefined,
      });
    });

    const hasNextPage = $("a:has(img[alt=Next])").length > 0;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ComicKFanMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: ComicKFanSearchMeta } | undefined
    )?.searchMeta;

    const url = this.buildSearchUrl(
      {
        sort: searchMeta?.sort?.[0],
        status: searchMeta?.status?.[0],
        type: searchMeta?.type?.[0],
        genres: searchMeta?.genres,
      },
      titleQuery,
      page,
    );
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    this.eachSearchItem($, (item) => {
      results.push({
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $("a:has(img[alt=Next])").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    opts: {
      sort?: string;
      status?: string;
      type?: string;
      genres?: string[];
    },
    titleQuery: string,
    page: number,
  ): string {
    const params: string[] = [];
    const genres = opts.genres ?? [];
    params.push(`genres=${encodeURIComponent(genres.join("_"))}`);
    params.push(`status=${encodeURIComponent(opts.status ?? "")}`);
    params.push(`type=${encodeURIComponent(opts.type ?? "")}`);
    params.push(`sort=${encodeURIComponent(opts.sort ?? "")}`);
    params.push(`name=${encodeURIComponent(titleQuery)}`);
    params.push(`page=${page}`);
    return `${BASE_URL}/advanced-search?${params.join("&")}`;
  }

  private eachSearchItem(
    $: CheerioAPI,
    cb: (item: { mangaId: string; title: string; imageUrl: string }) => void,
  ): void {
    $("div:has(> form) + div.grid > a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const img = el.find("img").first();
      const title = (img.attr("alt") || "").trim();
      if (!title) return;
      const imageUrl = this.absoluteUrl(img.attr("src") || "");
      cb({ mangaId: this.parsePath(href), title, imageUrl });
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const infoRoot = $("div[class=bg-card-section]");

    const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
    const synopsis = $("div.comic-content.desk").first().text().trim();
    const author = this.getValue($, infoRoot, "Author");
    const artist = this.getValue($, infoRoot, "Artist");
    const statusText = this.getValue($, infoRoot, "Status");

    const thumbnailUrl = this.absoluteUrl(
      infoRoot.find("div.thumb-cover img").first().attr("src") || "",
    );

    const genres = infoRoot
      .find("div.font-medium:contains(Genres) + div a")
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
        artist: artist || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  private getValue(
    $: CheerioAPI,
    infoRoot: Cheerio<AnyNode>,
    label: string,
  ): string {
    let value = "";
    infoRoot.find("div.flex-row.gap-4").each((_, element) => {
      if (value) return;
      const el = $(element);
      const labelText = el.find("> div.text-sm").first().text().trim();
      if (labelText !== label) return;
      const text = el
        .find("> div.text-sm:nth-child(2):last-child")
        .text()
        .trim();
      if (text && text !== "-" && text !== "_") value = text;
    });
    return value;
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const comicId = this.comicIdFromMangaId(sourceManga.mangaId);
    const url = `${BASE_URL}/api/comics/${comicId}/chapter-list?translation_group_id=`;
    const response = await this.fetchJson<ComicKFanChapterListResponseDto>({
      url,
      method: "GET",
    });

    const chapters: Chapter[] = [];
    for (const dto of response.data ?? []) {
      const chapterId = this.parsePath(
        `/manga/${comicId}/chapter-${dto.chapter}-${dto.hash_id}`,
      );
      const chapNum = parseFloat(dto.chapter);
      chapters.push({
        chapterId,
        sourceManga,
        title: `Chapter ${dto.chapter}`,
        volume: 0,
        chapNum: isNaN(chapNum) ? -1 : chapNum,
        publishDate: this.parseDate(dto.published_at ?? dto.created_at),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div.w-full > img[loading=lazy]").each((_, element) => {
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

  private comicIdFromMangaId(mangaId: string): string {
    // mangaId is /manga/{slug}; comicId is the slug (2nd path segment).
    const decoded = this.safeDecode(mangaId).replace(/^\/+/, "");
    const segments = decoded.split("/");
    return segments[1] ?? segments[segments.length - 1] ?? decoded;
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
    const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
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
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    return "Unknown";
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    const d = new Date(dateText);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }
}

export const ComicKFan = new ComicKFanExtension();
