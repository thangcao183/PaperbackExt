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
import { StoneScapeSearchForm, StoneScapeSearchMeta } from "./forms";

const BASE_URL = "https://stonescape.xyz";
const API_URL = `${BASE_URL}/api`;
const PAGE_LIMIT = 24;

interface PaginationDto {
  page?: number;
  totalPages?: number;
}

interface SeriesDto {
  title: string;
  slug: string;
  coverUrl?: string;
  description?: string;
  publicationStatus?: string;
  author?: string;
  artist?: string;
  genres?: string[];
}

interface SeriesResponse {
  data: SeriesDto[];
  pagination?: PaginationDto;
}

interface ChapterDto {
  chapterId: string;
  chapterNumber: string;
  title?: string;
  createdAt?: string;
}

interface ChapterListResponse {
  chapters: ChapterDto[];
}

interface PageDto {
  pageNumber?: number;
  url: string;
}

interface ChapterDetailsDto {
  pages?: PageDto[];
  images?: PageDto[];
}

class StoneScapeInterceptor extends PaperbackInterceptor {
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
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

type StoneScapeImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class StoneScapeExtension implements StoneScapeImplementation {
  requestManager = new StoneScapeInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
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
      { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;

    const url =
      section.id === "popular"
        ? `${API_URL}/series/popular?page=${page}&period=week&contentType=manhwa&limit=${PAGE_LIMIT}`
        : `${API_URL}/series?page=${page}&limit=${PAGE_LIMIT}&contentType=manhwa`;

    const result = await this.fetchJson<SeriesResponse>({ url, method: "GET" });
    const list = result.data ?? [];
    const itemType = section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    const items: DiscoverSectionItem[] = list.map((s) => ({
      type: itemType,
      mangaId: this.toSafeId(s.slug),
      imageUrl: this.coverUrl(s.coverUrl),
      title: s.title,
      metadata: undefined,
    }));

    const current = result.pagination?.page ?? 1;
    const total = result.pagination?.totalPages ?? 1;
    return { items, metadata: current < total ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (query.metadata as { searchMeta?: StoneScapeSearchMeta } | undefined)
      ?.searchMeta;

    let url = `${API_URL}/series?page=${page}&limit=${PAGE_LIMIT}&contentType=manhwa`;
    if (titleQuery.length > 0) url += `&search=${encodeURIComponent(titleQuery)}`;
    const status = searchMeta?.status?.[0];
    if (status && status.length > 0) url += `&status=${encodeURIComponent(status)}`;
    const genres = searchMeta?.genres ?? [];
    if (genres.length > 0) url += `&genres=${encodeURIComponent(genres.join(","))}`;

    const result = await this.fetchJson<SeriesResponse>({ url, method: "GET" });
    const list = result.data ?? [];
    const items: SearchResultItem[] = list.map((s) => ({
      mangaId: this.toSafeId(s.slug),
      imageUrl: this.coverUrl(s.coverUrl),
      title: s.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const current = result.pagination?.page ?? 1;
    const total = result.pagination?.totalPages ?? 1;
    return { items, metadata: current < total ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: StoneScapeSearchMeta } | undefined)?.searchMeta;
    return new StoneScapeSearchForm(meta);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const series = await this.fetchJson<SeriesDto>({
      url: `${API_URL}/series/by-slug/${slug}`,
      method: "GET",
    });

    const genreNames = (series.genres ?? []).map(
      (g) => g.charAt(0).toUpperCase() + g.slice(1),
    );
    const tagGroups: TagSection[] =
      genreNames.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genreNames.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(series.coverUrl),
        author: this.cleanField(series.author),
        artist: this.cleanField(series.artist),
        synopsis: (series.description ?? "").trim(),
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(series.publicationStatus),
        tagGroups,
        shareUrl: `${BASE_URL}/series/${slug}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const result = await this.fetchJson<ChapterListResponse>({
      url: `${API_URL}/series/by-slug/${slug}/chapters`,
      method: "GET",
    });

    const chapters: Chapter[] = (result.chapters ?? []).map((ch) => {
      const num = parseFloat(ch.chapterNumber);
      const numStr = Number.isFinite(num) ? String(num).replace(/\.0$/, "") : ch.chapterNumber;
      let name = `Chapter ${numStr}`;
      if (ch.title && ch.title.trim().length > 0) name += ` - ${ch.title.trim()}`;
      return {
        chapterId: this.toSafeId(ch.chapterId),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: Number.isFinite(num) ? num : -1,
        publishDate: this.parseDate(ch.createdAt),
        langCode: "\ud83c\uddec\ud83c\udde7",
      };
    });

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = this.safeDecode(chapter.chapterId);
    const result = await this.fetchJson<ChapterDetailsDto>({
      url: `${API_URL}/chapters/${chapterId}/pages`,
      method: "GET",
    });

    const allPages = (result.pages && result.pages.length > 0 ? result.pages : result.images) ?? [];
    const pages = allPages.map((p) => `${BASE_URL}${p.url}`);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/series/${this.safeDecode(mangaId)}`;
  }

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

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  private coverUrl(coverUrl?: string): string {
    if (!coverUrl) return "";
    if (/^https?:\/\//.test(coverUrl)) return coverUrl;
    return `${BASE_URL}${coverUrl}`;
  }

  private cleanField(value?: string): string | undefined {
    const v = (value ?? "").trim();
    if (v.length === 0 || v === "-" || v.toLowerCase() === "n/a") return undefined;
    return v;
  }

  private parseStatus(status?: string): string {
    const s = (status ?? "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    if (s === "hiatus") return "Hiatus";
    if (s === "dropped" || s === "cancelled") return "Cancelled";
    return "Unknown";
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date(0) : d;
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
}

export const StoneScape = new StoneScapeExtension();
