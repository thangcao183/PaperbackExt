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

const BASE_URL = "https://play.mobilelegends.com";
const API_URL = "https://api.mobilelegends.com";

const TYPE_COMIC = 3;
const SORT_NEWEST = 1;
const SORT_POPULARITY = 3;
const PAGE_SIZE = 5;

interface MLBBLoreMetadata {
  page?: number;
}

interface AlbumEntry {
  id?: number;
  type?: number;
  title?: string;
  hero_name?: string;
  thumb?: string;
}

interface AlbumDetail {
  id?: number;
  title?: string;
  hero_name?: string;
  thumb?: string;
  share_content?: string;
  comic_content?: string[];
}

interface ApiListResponse {
  data?: AlbumEntry[];
}

interface ApiDetailResponse {
  data?: AlbumDetail | null;
}

class MLBBLoreInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json, text/plain, */*",
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

type MLBBLoreImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MLBBLoreExtension implements MLBBLoreImplementation {
  requestManager = new MLBBLoreInterceptor("main");
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
    const meta = metadata as MLBBLoreMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "latest" ? SORT_NEWEST : SORT_POPULARITY;

    const entries = await this.fetchAlbumList(sort, page);

    const items: DiscoverSectionItem[] = entries.map((entry) => ({
      type:
        section.id === "latest"
          ? "simpleCarouselItem"
          : "featuredCarouselItem",
      mangaId: String(entry.id),
      imageUrl: this.absoluteUrl(entry.thumb ?? ""),
      title: entry.title ?? "",
      subtitle: (entry.hero_name ?? "").trim() || undefined,
      metadata: undefined,
    }));

    const hasNext = entries.length >= PAGE_SIZE;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    _query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    // Upstream search has no real query support; it returns the popular list.
    const meta = metadata as MLBBLoreMetadata | undefined;
    const page = meta?.page ?? 1;

    const entries = await this.fetchAlbumList(SORT_POPULARITY, page);

    const results: SearchResultItem[] = entries.map((entry) => ({
      mangaId: String(entry.id),
      imageUrl: this.absoluteUrl(entry.thumb ?? ""),
      title: entry.title ?? "",
      subtitle: (entry.hero_name ?? "").trim() || undefined,
      metadata: undefined,
    }));

    const hasNext = entries.length >= PAGE_SIZE;
    return { items: results, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const detail = await this.fetchAlbumDetail(mangaId);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: detail?.title ?? this.safeDecode(mangaId),
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(detail?.thumb ?? ""),
        author: (detail?.hero_name ?? "").trim(),
        artist: (detail?.hero_name ?? "").trim(),
        synopsis: detail?.share_content ?? "",
        contentRating: ContentRating.EVERYONE,
        status: "Completed",
        tagGroups: [],
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const detail = await this.fetchAlbumDetail(sourceManga.mangaId);
    if (!detail) return [];

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
    const detail = await this.fetchAlbumDetail(chapter.chapterId);
    const pages = (detail?.comic_content ?? [])
      .map((raw) => this.absoluteUrl(raw))
      .filter((url) => url.length > 0);

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
  // API helpers
  // ----------------------------------------------------------------

  private async fetchAlbumList(
    sort: number,
    page: number,
  ): Promise<AlbumEntry[]> {
    const body = this.formBody({
      type: String(TYPE_COMIC),
      sort: String(sort),
      page: String(page),
      page_size: String(PAGE_SIZE),
      lang: "en",
      token: "",
    });
    const parsed = await this.fetchJson<ApiListResponse>(
      `${API_URL}/lore/album/list`,
      body,
    );
    return (parsed.data ?? []).filter((entry) => entry.type === TYPE_COMIC);
  }

  private async fetchAlbumDetail(id: string): Promise<AlbumDetail | null> {
    const body = this.formBody({
      id: this.safeDecode(id),
      lang: "en",
      token: "",
    });
    const parsed = await this.fetchJson<ApiDetailResponse>(
      `${API_URL}/lore/album/detail`,
      body,
    );
    return parsed.data ?? null;
  }

  private formBody(params: Record<string, string>): string {
    return Object.entries(params)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");
  }

  private async fetchJson<T>(url: string, body: string): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json, text/plain, */*",
      },
      body,
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }

  // ----------------------------------------------------------------
  // URL / id helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/`;
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
}

export const MLBBLore = new MLBBLoreExtension();
