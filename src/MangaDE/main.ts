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

const BASE_URL = "https://mangade.io";
const API_URL = "https://api.mangade.io/api";
const PAGE_SIZE = 20;

interface MangaDEMetadata {
  page?: number;
  genre?: string;
}

interface PayloadDto<T> {
  data: T;
}

interface MangaListPageDto {
  list: MangaDto[];
  totalPage: number;
  page: string;
}

interface PageDto {
  image: string;
}

interface ChapterDto {
  id: string;
  name: string;
  slug?: string;
  chapter_number?: string;
  published_date?: string;
  chapter_images?: PageDto[];
}

interface MangaDto {
  id: string;
  name: string;
  slug?: string;
  image: string;
  description?: string;
  genre_names?: string;
  status?: string;
  news_chapters?: ChapterDto[];
}

interface GenreDto {
  id: string;
  name: string;
}

interface GenreListPageDto {
  genres: GenreDto[];
}

class MangaDEInterceptor extends PaperbackInterceptor {
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

type MangaDEImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaDEExtension implements MangaDEImplementation {
  requestManager = new MangaDEInterceptor("main");
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
        id: "most-viewed",
        title: "Most Viewed",
        type: DiscoverSectionType.featured,
      },
      {
        id: "newest",
        title: "Latest Updates",
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
      const genres = await this.fetchGenres();
      const items: DiscoverSectionItem[] = genres.map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: g.id },
        },
        name: g.name,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as MangaDEMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "newest" ? "newest" : "most-viewed";

    const url = `${API_URL}/comics?page=${page}&size=${PAGE_SIZE}&sort=${sort}`;
    const payload = await this.fetchJson<PayloadDto<MangaListPageDto>>(url);

    const list = payload.data.list ?? [];
    const items: DiscoverSectionItem[] = list.map((m) => ({
      type:
        section.id === "newest" ? "simpleCarouselItem" : "featuredCarouselItem",
      mangaId: this.buildMangaId(m),
      imageUrl: this.absoluteUrl(m.image),
      title: m.name,
      metadata: undefined,
    }));

    const hasNext = this.hasNextPage(payload.data);
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaDEMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as { genre?: string } | undefined;
    const genre = meta?.genre ?? queryMeta?.genre;

    const params: string[] = [];
    params.push(`page=${page}`);
    params.push(`size=${PAGE_SIZE}`);
    if (titleQuery) params.push(`name=${encodeURIComponent(titleQuery)}`);
    if (genre) params.push(`genres[]=${encodeURIComponent(genre)}`);

    const url = `${API_URL}/comics?${params.join("&")}`;
    const payload = await this.fetchJson<PayloadDto<MangaListPageDto>>(url);

    const list = payload.data.list ?? [];
    const results: SearchResultItem[] = list.map((m) => ({
      mangaId: this.buildMangaId(m),
      imageUrl: this.absoluteUrl(m.image),
      title: m.name,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNext = this.hasNextPage(payload.data);
    return {
      items: results,
      metadata: hasNext ? { page: page + 1, genre } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.mangaApiId(mangaId);
    const url = `${API_URL}/comics/${id}/view`;
    const payload = await this.fetchJson<PayloadDto<MangaDto>>(url);
    const m = payload.data;

    const tagGroups: TagSection[] = [];
    const genreNames = (m.genre_names || "")
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    if (genreNames.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreNames.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: m.name,
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(m.image),
        synopsis: m.description || "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(m.status),
        tagGroups,
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.mangaApiId(sourceManga.mangaId);
    const slug = this.mangaSlug(sourceManga.mangaId);
    const url = `${API_URL}/comics/${id}/view`;
    const payload = await this.fetchJson<PayloadDto<MangaDto>>(url);

    const newsChapters = payload.data.news_chapters ?? [];
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const c of newsChapters) {
      const chapterId = this.buildChapterId(c, id, slug);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const chapNum = c.chapter_number ? parseFloat(c.chapter_number) : -1;
      chapters.push({
        chapterId,
        sourceManga,
        title: c.name,
        volume: 0,
        chapNum: Number.isNaN(chapNum) ? -1 : chapNum,
        publishDate: this.parseDate(c.published_date),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const cid = this.chapterApiId(chapter.chapterId);
    const url = `${API_URL}/chapters/${cid}/view`;
    const payload = await this.fetchJson<PayloadDto<ChapterDto>>(url);

    const images = payload.data.chapter_images ?? [];
    const pages = images
      .map((p) => this.absoluteUrl(p.image))
      .filter((p) => p.length > 0);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const id = this.mangaApiId(mangaId);
    const slug = this.mangaSlug(mangaId);
    return `${BASE_URL}/comic/${slug}-pid${id}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private async fetchGenres(): Promise<GenreDto[]> {
    try {
      const url = `${API_URL}/genres?size=500`;
      const payload = await this.fetchJson<PayloadDto<GenreListPageDto>>(url);
      return payload.data.genres ?? [];
    } catch {
      return [];
    }
  }

  // mangaId encodes "<slug>?mid=<id>" so both the API id and slug round-trip.
  private buildMangaId(m: MangaDto): string {
    const slug = m.slug || m.id;
    return this.toSafeId(`${slug}?mid=${m.id}`);
  }

  private mangaApiId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const m = decoded.match(/mid=([^&]+)/);
    if (m) return m[1];
    // Fallback: trailing path may itself be an id
    return decoded.replace(/\?.*$/, "");
  }

  private mangaSlug(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    return decoded.replace(/\?.*$/, "").replace(/^\/+/, "");
  }

  // chapterId encodes "<mangaSlug>/<chapterSlug>?cid=<id>&mid=<mangaId>"
  private buildChapterId(
    c: ChapterDto,
    mangaId: string,
    mangaSlug: string,
  ): string {
    const chapterSlug = c.slug || c.id;
    return this.toSafeId(
      `${mangaSlug}/${chapterSlug}?cid=${c.id}&mid=${mangaId}`,
    );
  }

  private chapterApiId(chapterId: string): string {
    const decoded = this.safeDecode(chapterId);
    const m = decoded.match(/cid=([^&]+)/);
    if (m) return m[1];
    return decoded.replace(/\?.*$/, "");
  }

  private parseStatus(status: string | undefined): string {
    switch (status) {
      case "Ongoing":
      case "Releasing":
        return "Ongoing";
      case "Completed":
        return "Completed";
      case "On Hiatus":
        return "Hiatus";
      default:
        return "Unknown";
    }
  }

  private parseDate(value: string | undefined): Date {
    if (!value) return new Date(0);
    // Upstream format: "yyyy-MM-dd HH:mm:ss"
    const iso = value.trim().replace(" ", "T");
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
    const d2 = new Date(value);
    return Number.isNaN(d2.getTime()) ? new Date(0) : d2;
  }

  private hasNextPage(data: MangaListPageDto): boolean {
    const current = parseInt(data.page, 10);
    if (Number.isNaN(current)) return false;
    return current < data.totalPage;
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

  async fetchJson<T>(url: string): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

export const MangaDE = new MangaDEExtension();
