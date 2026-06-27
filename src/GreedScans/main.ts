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

const BASE_URL = "https://gojoscans.com";
const API_URL = "https://api.gojoscans.com/api";
const PER_PAGE = 24;

// Genre options ported from the upstream Kotlin GenreFilter (deduped by slug).
const GENRES: { title: string; slug: string }[] = [
  { title: "Action", slug: "action" },
  { title: "Fantasy", slug: "fantasy" },
  { title: "Adventure", slug: "adventure" },
  { title: "Drama", slug: "drama" },
  { title: "Comedy", slug: "comedy" },
  { title: "Romance", slug: "romance" },
  { title: "Shounen", slug: "shounen" },
  { title: "Isekai", slug: "isekai" },
  { title: "Murim", slug: "murim" },
  { title: "Reincarnation", slug: "reincarnation" },
  { title: "Manhwa", slug: "manhwa" },
  { title: "Mystery", slug: "mystery" },
  { title: "Tragedy", slug: "tragedy" },
  { title: "Webtoons", slug: "webtoons" },
  { title: "Revenge", slug: "revenge" },
  { title: "Slice of Life", slug: "slice-of-life" },
  { title: "Martial Arts", slug: "martial-arts" },
  { title: "School Life", slug: "school-life" },
  { title: "Regression", slug: "regression" },
  { title: "Overpowered", slug: "overpowered" },
  { title: "Historical", slug: "historical" },
  { title: "Supernatural", slug: "supernatural" },
  { title: "Game", slug: "game" },
  { title: "Genius MC", slug: "genius-mc" },
  { title: "System", slug: "system" },
  { title: "Magic", slug: "magic" },
  { title: "Shoujo", slug: "shoujo" },
  { title: "Sci-Fi", slug: "sci-fi" },
  { title: "Wuxia", slug: "wuxia" },
  { title: "Horror", slug: "horror" },
  { title: "Seinen", slug: "seinen" },
  { title: "Psychological", slug: "psychological" },
  { title: "Manhua", slug: "manhua" },
  { title: "Sports", slug: "sports" },
  { title: "Thriller", slug: "thriller" },
  { title: "Dungeons", slug: "dungeons" },
  { title: "Crime", slug: "crime" },
  { title: "Demon", slug: "demon" },
  { title: "Superhero", slug: "superhero" },
  { title: "Crazy MC", slug: "crazy-mc" },
  { title: "Harem", slug: "harem" },
  { title: "Necromancer", slug: "necromancer" },
  { title: "Tower", slug: "tower" },
  { title: "Full Color", slug: "full-color" },
  { title: "Violence", slug: "violence" },
  { title: "Ecchi", slug: "ecchi" },
  { title: "Adaptation", slug: "adaptation" },
  { title: "Long Strip", slug: "long-strip" },
  { title: "Villain", slug: "villain" },
  { title: "Mature", slug: "mature" },
  { title: "Comic", slug: "comic" },
  { title: "Monsters", slug: "monsters" },
  { title: "Medical", slug: "medical" },
  { title: "Manga", slug: "manga" },
  { title: "Time Travel", slug: "time-travel" },
  { title: "Cooking", slug: "cooking" },
  { title: "One Shot", slug: "one-shot" },
];

interface GreedScansMetadata {
  page?: number;
  genre?: string;
}

interface BrowseSeries {
  title?: string;
  slug?: string;
  cover_image?: string | null;
  status?: string | null;
}

interface PaginatedData {
  data?: BrowseSeries[];
  current_page?: number;
  last_page?: number;
}

interface SeriesListResponse {
  data?: PaginatedData;
}

interface SeriesChapter {
  title?: string;
  slug?: string;
  chapter_number?: number;
  created_at?: string | null;
  published_at?: string | null;
}

interface SeriesDetail {
  title?: string;
  slug?: string;
  synopsis?: string | null;
  author?: string | null;
  studio?: string | null;
  cover_image?: string | null;
  status?: string | null;
  genres?: string[];
  alternative_titles?: string[];
  chapters?: SeriesChapter[];
}

interface SeriesDetailResponse {
  data?: SeriesDetail;
}

interface PageImage {
  image_url?: string;
}

interface ChapterDetailResponse {
  data?: {
    chapter?: {
      images?: PageImage[];
    };
  };
}

class GreedScansInterceptor extends PaperbackInterceptor {
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

type GreedScansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class GreedScansExtension implements GreedScansImplementation {
  requestManager = new GreedScansInterceptor("main");
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
        id: "latest_update",
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
      const items: DiscoverSectionItem[] = GENRES.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          metadata: { genre: genre.slug },
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as GreedScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const sortBy = section.id === "popular" ? "popular" : "latest_update";

    const url = this.seriesListUrl({ page, sortBy });
    const response = await this.fetchJson<SeriesListResponse>(url);
    const paginated = response.data;
    const series = paginated?.data ?? [];

    const items: DiscoverSectionItem[] = [];
    for (const s of series) {
      const parsed = this.itemFromSeries(s);
      if (!parsed) continue;
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
    }

    const hasNext = this.hasNextPage(paginated);
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as GreedScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as GreedScansMetadata | undefined;
    const genre = queryMeta?.genre;

    const url = this.seriesListUrl({
      page,
      search: titleQuery,
      genres: genre ? [genre] : [],
    });
    const response = await this.fetchJson<SeriesListResponse>(url);
    const paginated = response.data;
    const series = paginated?.data ?? [];

    const results: SearchResultItem[] = [];
    for (const s of series) {
      const parsed = this.itemFromSeries(s);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = this.hasNextPage(paginated);
    return {
      items: results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private itemFromSeries(
    s: BrowseSeries,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const slug = (s.slug || "").trim();
    const title = (s.title || "").trim();
    if (!slug || !title) return undefined;
    const mangaId = this.toSafeId(slug);
    const imageUrl = this.absoluteUrl(s.cover_image || "");
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const url = `${API_URL}/series/${slug}`;
    const response = await this.fetchJson<SeriesDetailResponse>(url);
    const data = response.data;

    const title = (data?.title || "").trim() || slug;
    const genres = (data?.genres ?? []).filter((g) => g && g.length > 0);
    const altTitles = (data?.alternative_titles ?? []).filter(
      (t) => t && t.length > 0,
    );

    let synopsis = (data?.synopsis || "").trim();
    if (altTitles.length > 0) {
      synopsis += `${synopsis ? "\n\n" : ""}Alternative Titles:\n${altTitles.join("\n")}`;
    }

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
        secondaryTitles: altTitles,
        thumbnailUrl: this.absoluteUrl(data?.cover_image || ""),
        author: (data?.author || "").trim() || undefined,
        artist: (data?.studio || "").trim() || undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(data?.status),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const url = `${API_URL}/series/${slug}`;
    const response = await this.fetchJson<SeriesDetailResponse>(url);
    const data = response.data;
    const seriesSlug = (data?.slug || slug).trim();

    const rawChapters = (data?.chapters ?? []).slice();
    rawChapters.sort(
      (a, b) => (b.chapter_number ?? 0) - (a.chapter_number ?? 0),
    );

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const ch of rawChapters) {
      const chSlug = (ch.slug || "").trim();
      if (!chSlug) continue;
      const chapterId = this.toSafeId(`${seriesSlug}/chapters/${chSlug}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const dateStr = ch.published_at || ch.created_at || "";
      chapters.push({
        chapterId,
        sourceManga,
        title: (ch.title || "").trim(),
        volume: 0,
        chapNum: ch.chapter_number ?? 0,
        publishDate: this.parseDate(dateStr),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = this.safeDecode(chapter.chapterId);
    const url = `${API_URL}/series/${path}`;
    const response = await this.fetchJson<ChapterDetailResponse>(url);
    const images = response.data?.chapter?.images ?? [];

    const pages: string[] = [];
    for (const img of images) {
      const src = (img.image_url || "").trim();
      if (src) pages.push(this.absoluteUrl(src));
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

  private seriesListUrl(opts: {
    page: number;
    sortBy?: string;
    search?: string;
    genres?: string[];
  }): string {
    const params: string[] = [];
    params.push(`page=${opts.page}`);
    params.push(`per_page=${PER_PAGE}`);
    params.push(`sort_order=desc`);
    if (opts.sortBy) params.push(`sort_by=${encodeURIComponent(opts.sortBy)}`);
    if (opts.search && opts.search.length > 0) {
      params.push(`search=${encodeURIComponent(opts.search)}`);
    }
    for (const g of opts.genres ?? []) {
      params.push(`genres[]=${encodeURIComponent(g)}`);
    }
    return `${API_URL}/series?${params.join("&")}`;
  }

  private hasNextPage(paginated: PaginatedData | undefined): boolean {
    if (!paginated) return false;
    const current = paginated.current_page ?? 0;
    const last = paginated.last_page ?? 0;
    return current < last;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/series/${slug.replace(/^\/+/, "")}`;
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

  private parseStatus(status: string | null | undefined): string {
    switch ((status || "").toLowerCase()) {
      case "ongoing":
        return "Ongoing";
      case "completed":
        return "Completed";
      case "hiatus":
        return "Hiatus";
      default:
        return "Unknown";
    }
  }

  private parseDate(dateStr: string): Date {
    const s = (dateStr || "").trim();
    if (!s) return new Date(0);
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? new Date(0) : new Date(parsed);
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
    const jsonStr = Application.arrayBufferToUTF8String(data);
    return JSON.parse(jsonStr) as T;
  }
}

export const GreedScans = new GreedScansExtension();
