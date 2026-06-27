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

const BASE_URL = "https://app.ninekon.com";
const API_URL = "https://api.ninekon.com/1.0";

interface NinekonMetadata {
  page?: number;
  genre?: string;
}

const GENRES: { title: string; value: string }[] = [
  { title: "Action", value: "action" },
  { title: "Adult", value: "adult" },
  { title: "Adventure", value: "adventure" },
  { title: "Comedy", value: "comedy" },
  { title: "Cooking", value: "cooking" },
  { title: "Doujinshi", value: "doujinshi" },
  { title: "Drama", value: "drama" },
  { title: "Ecchi", value: "ecchi" },
  { title: "Erotica", value: "erotica" },
  { title: "Fantasy", value: "fantasy" },
  { title: "Gender bender", value: "gender-bender" },
  { title: "Harem", value: "harem" },
  { title: "Historical", value: "historical" },
  { title: "Horror", value: "horror" },
  { title: "Isekai", value: "isekai" },
  { title: "Josei", value: "josei" },
  { title: "Manhua", value: "manhua" },
  { title: "Manhwa", value: "manhwa" },
  { title: "Martial Arts", value: "martial-arts" },
  { title: "Mature", value: "mature" },
  { title: "Mecha", value: "mecha" },
  { title: "Medical", value: "medical" },
  { title: "Mystery", value: "mystery" },
  { title: "One Shot", value: "one-shot" },
  { title: "Psychological", value: "psychological" },
  { title: "Romance", value: "romance" },
  { title: "School Life", value: "school-life" },
  { title: "Sci Fi", value: "sci-fi" },
  { title: "Seinen", value: "seinen" },
  { title: "Shoujo", value: "shoujo" },
  { title: "Shoujo Ai", value: "shoujo-ai" },
  { title: "Shounen", value: "shounen" },
  { title: "Shounen Ai", value: "shounen-ai" },
  { title: "Slice of life", value: "slice-of-life" },
  { title: "Smut", value: "smut" },
  { title: "Sports", value: "sports" },
  { title: "Supernatural", value: "supernatural" },
  { title: "Tragedy", value: "tragedy" },
  { title: "Webtoons", value: "webtoons" },
  { title: "Yaoi", value: "yaoi" },
  { title: "Yuri", value: "yuri" },
];

interface BookDto {
  gid: string;
  title: string;
  cover?: string | null;
  host?: string | null;
}

interface BooksResponse {
  pages?: number;
  books?: BookDto[];
}

interface ChapterDto {
  gid: string;
  ordinal?: number | null;
}

interface BookDetailsDto {
  gid: string;
  title: string;
  summary?: string | null;
  author?: string | null;
  tags?: string | null;
  status?: string | null;
  host?: string | null;
  cover?: string | null;
  dt_updated?: string | null;
  chapters?: ChapterDto[];
}

interface PagesDto {
  host: string;
  pages?: string[];
}

class NinekonInterceptor extends PaperbackInterceptor {
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

type NinekonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class NinekonExtension implements NinekonImplementation {
  requestManager = new NinekonInterceptor("main");
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
      const items: DiscoverSectionItem[] = GENRES.map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: g.value },
        },
        name: g.title,
        metadata: { genre: g.value },
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as NinekonMetadata | undefined;
    const page = meta?.page ?? 1;

    const sortParam =
      section.id === "popular" ? "sort=views" : "sort=dt&order=desc";
    const url = `${API_URL}/books?${sortParam}&page=${page}`;
    const data = await this.fetchJSON<BooksResponse>({ url, method: "GET" });

    const items: DiscoverSectionItem[] = (data.books ?? []).map((book) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: this.toSafeId(book.gid),
      imageUrl: this.coverUrl(book),
      title: book.title,
      metadata: undefined,
    }));

    const totalPages = data.pages ?? 0;
    return {
      items,
      metadata: page < totalPages ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as NinekonMetadata | undefined;
    const queryMeta = query.metadata as NinekonMetadata | undefined;
    const page = meta?.page ?? 1;
    const genre = meta?.genre ?? queryMeta?.genre;
    const titleQuery = (query.title || "").trim();

    const params: string[] = [];
    params.push(`page=${page}`);

    if (titleQuery !== "") {
      params.push("field=title");
      params.push(`query=${encodeURIComponent(titleQuery)}`);
    }

    if (genre) {
      params.push(`tags=${encodeURIComponent(genre)}`);
    }

    params.push("sort=dt");
    params.push("order=desc");

    const url = `${API_URL}/books?${params.join("&")}`;
    const data = await this.fetchJSON<BooksResponse>({ url, method: "GET" });

    const items: SearchResultItem[] = (data.books ?? []).map((book) => ({
      mangaId: this.toSafeId(book.gid),
      imageUrl: this.coverUrl(book),
      title: book.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const totalPages = data.pages ?? 0;
    return {
      items,
      metadata: page < totalPages ? { page: page + 1, genre } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const gid = this.safeDecode(mangaId);
    const url = `${API_URL}/books/${gid}`;
    const data = await this.fetchJSON<BookDetailsDto>({ url, method: "GET" });

    const genres = (data.tags ?? "")
      .split("|")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

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
        primaryTitle: data.title,
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(data),
        author: data.author ?? undefined,
        artist: data.author ?? undefined,
        synopsis: data.summary ?? "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(data.status),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const gid = this.safeDecode(sourceManga.mangaId);
    const url = `${API_URL}/books/${gid}`;
    const data = await this.fetchJSON<BookDetailsDto>({ url, method: "GET" });

    const rawChapters = (data.chapters ?? []).slice().reverse();
    const updatedDate = this.parseDate(data.dt_updated);

    return rawChapters.map((ch, index) => {
      const chapNum = ch.ordinal ?? -1;
      const chapterPath = `/books/${gid}/chapters/${ch.gid}/pages`;
      return {
        chapterId: this.toSafeId(chapterPath),
        sourceManga,
        title: `Chapter ${chapNum >= 0 ? chapNum.toString() : "Unknown"}`,
        volume: 0,
        chapNum,
        publishDate: index === 0 ? updatedDate : new Date(0),
        langCode: "🇬🇧",
      };
    });
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = this.safeDecode(chapter.chapterId);
    const url = `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
    const data = await this.fetchJSON<PagesDto>({ url, method: "GET" });

    const host = data.host || "";
    const pages = (data.pages ?? []).map((p) =>
      p.startsWith("http") ? p : `${host}${p}`,
    );

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
    const gid = this.safeDecode(mangaId);
    if (gid.startsWith("http")) return gid;
    return `${BASE_URL}/book/${gid.replace(/^\/+/, "")}`;
  }

  private coverUrl(book: {
    host?: string | null;
    cover?: string | null;
  }): string {
    if (book.host && book.cover) {
      const cover = book.cover;
      return cover.startsWith("http") ? cover : `${book.host}${cover}`;
    }
    return "";
  }

  private parseStatus(status: string | null | undefined): string {
    const s = (status || "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    return "Unknown";
  }

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    // Format: "yyyy-MM-dd HH:mm:ss"
    const normalized = value.replace(" ", "T");
    const parsed = new Date(normalized);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
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

  async fetchJSON<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const jsonStr = Application.arrayBufferToUTF8String(data);
    return JSON.parse(jsonStr) as T;
  }
}

export const Ninekon = new NinekonExtension();
