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
  Form,
  MangaProviding,
  Metadata,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SettingsFormProviding,
  SourceManga,
  TagSection,
} from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { EZManhwaSearchForm, EZManhwaSearchMeta } from "./forms";
import {
  getBaseUrlOverride,
  getShowLockedChapters,
  EZManhwaSettingsForm,
} from "./settings";

export interface EZManhwaConfig {
  name: string;
  baseUrl: string;
  /**
   * EZManhwa sites serve their JSON API from a dedicated host that cannot be
   * derived from the base URL (e.g. ezmanga.org -> vapi.ezmanga.org/api/v1),
   * so this must be provided explicitly.
   */
  apiUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
}

// --- JSON DTO shapes (subset of the keiyoushi EZManhwa DTOs) ---

interface EZManhwaGenre {
  name: string;
}

interface EZManhwaSeries {
  slug: string;
  title: string;
  cover?: string | null;
  type?: string | null;
  status?: string | null;
  alternativeTitles?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: EZManhwaGenre[];
}

interface EZManhwaSeriesListResponse {
  data: EZManhwaSeries[];
  totalPages?: number;
  current?: number;
}

interface EZManhwaChapter {
  slug: string;
  number?: number | null;
  title?: string | null;
  requiresPurchase?: boolean;
  createdAt?: string | null;
}

interface EZManhwaChapterListResponse {
  data: EZManhwaChapter[];
  totalPages?: number;
  current?: number;
}

interface EZManhwaPageImage {
  url: string;
}

interface EZManhwaPageListResponse {
  images?: EZManhwaPageImage[];
  requiresPurchase?: boolean;
  totalImages?: number;
}

class EZManhwaInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    request.headers = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
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
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
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

type EZManhwaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class EZManhwaExtension implements EZManhwaImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly defaultApiUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;
  static readonly PER_PAGE = 20;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  /**
   * The API host lives on a separate domain from the site, so the base-URL
   * override (which only changes the reader site) does not affect it.
   */
  get apiUrl(): string {
    return this.defaultApiUrl;
  }

  requestManager: EZManhwaInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: EZManhwaConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.defaultApiUrl = config.apiUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new EZManhwaInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new EZManhwaSettingsForm(this.sourceName, this.defaultBaseUrl);
  }

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
        id: "popular_section",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest_section",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let sort: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        sort = "popular";
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        sort = "latest";
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

    const url = new URLBuilder(this.apiUrl)
      .addPath("series")
      .addQuery("page", "1")
      .addQuery("perPage", EZManhwaExtension.PER_PAGE.toString())
      .addQuery("sort", sort)
      .build();

    const data = await this.fetchJson<EZManhwaSeriesListResponse>({
      url,
      method: "GET",
    });

    const items: DiscoverSectionItem[] = [];
    for (const series of data.data ?? []) {
      if (this.isNovel(series)) continue;
      items.push({
        type: itemType,
        mangaId: this.toSafeId(series.slug),
        imageUrl: series.cover ?? "",
        title: series.title,
        metadata: undefined,
      });
    }

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions() {
    return [
      { id: "latest", label: "Latest" },
      { id: "popular", label: "Popular" },
      { id: "newest", label: "Newest" },
      { id: "alphabetical", label: "Alphabetical" },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<EZManhwaSearchForm> {
    const meta = (
      query.metadata as { searchMeta?: EZManhwaSearchMeta } | undefined
    )?.searchMeta;
    return new EZManhwaSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: { id: string; label: string },
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: EZManhwaSearchMeta } | undefined
    )?.searchMeta;

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    let builder: URLBuilder;
    if (titleQuery) {
      // Search endpoint: only a query term, no filters.
      builder = new URLBuilder(this.apiUrl)
        .addPath("series")
        .addPath("search")
        .addQuery("page", page.toString())
        .addQuery("perPage", EZManhwaExtension.PER_PAGE.toString())
        .addQuery("q", titleQuery);
    } else {
      // Browse endpoint: sort + status + type filters apply here.
      const sortId = sortingOption?.id ?? "";
      const filterSort = searchMeta?.sort?.[0] ?? "";
      const effectiveSort = sortId || filterSort || "latest";

      builder = new URLBuilder(this.apiUrl)
        .addPath("series")
        .addQuery("page", page.toString())
        .addQuery("perPage", EZManhwaExtension.PER_PAGE.toString())
        .addQuery("sort", effectiveSort);

      const status = searchMeta?.status?.[0];
      if (status) builder.addQuery("status", status);
      const type = searchMeta?.type?.[0];
      if (type) builder.addQuery("type", type);
    }

    const data = await this.fetchJson<EZManhwaSeriesListResponse>({
      url: builder.build(),
      method: "GET",
    });

    const results: SearchResultItem[] = [];
    for (const series of data.data ?? []) {
      if (this.isNovel(series)) continue;
      results.push({
        mangaId: this.toSafeId(series.slug),
        imageUrl: series.cover ?? "",
        title: series.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const totalPages = data.totalPages ?? 0;
    const currentPage = data.current ?? page;
    const hasNextPage = currentPage < totalPages;
    const reachedPageLimit = page >= EZManhwaExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.slugFromId(mangaId);
    const url = new URLBuilder(this.apiUrl)
      .addPath("series")
      .addPath(slug)
      .build();

    const series = await this.fetchJson<EZManhwaSeries>({
      url,
      method: "GET",
    });

    const secondaryTitles: string[] = [];
    if (series.alternativeTitles && series.alternativeTitles.trim()) {
      secondaryTitles.push(series.alternativeTitles.trim());
    }

    const genres: string[] = [];
    for (const g of series.genres ?? []) {
      if (g.name) genres.push(g.name);
    }
    const uniqueGenres = [...new Set(genres)];

    const tagGroups: TagSection[] = [];
    if (uniqueGenres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: uniqueGenres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles,
        thumbnailUrl: series.cover ?? "",
        author: this.cleanField(series.author),
        artist: this.cleanField(series.artist),
        synopsis: this.stripHtml(series.description ?? ""),
        contentRating: this.contentRating,
        status: this.parseStatus(series.status ?? ""),
        tagGroups,
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.slugFromId(sourceManga.mangaId);
    const showLocked = getShowLockedChapters(this.sourceName);

    const chapters: Chapter[] = [];
    let page = 1;
    // Bound the loop to avoid runaway pagination.
    for (let i = 0; i < 50; i++) {
      const url = new URLBuilder(this.apiUrl)
        .addPath("series")
        .addPath(slug)
        .addPath("chapters")
        .addQuery("page", page.toString())
        .addQuery("perPage", "100")
        .addQuery("sort", "desc")
        .build();

      const data = await this.fetchJson<EZManhwaChapterListResponse>({
        url,
        method: "GET",
      });

      for (const ch of data.data ?? []) {
        const locked = ch.requiresPurchase === true;
        if (locked && !showLocked) continue;

        const chapterId = this.toSafeId(
          `series/${slug}/chapters/${ch.slug}`,
        );

        const prefix = locked ? "🔒 " : "";
        chapters.push({
          chapterId,
          sourceManga,
          title: prefix + this.buildChapterName(ch),
          volume: 0,
          chapNum:
            typeof ch.number === "number" && !isNaN(ch.number)
              ? ch.number
              : -1,
          publishDate: this.parseDate(ch.createdAt ?? ""),
          langCode: this.langCode,
        });
      }

      const totalPages = data.totalPages ?? 0;
      const currentPage = data.current ?? page;
      if (currentPage >= totalPages) break;
      page++;
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // chapterId encodes the full path `series/{slug}/chapters/{chapterSlug}`.
    const path = this.safeDecode(chapter.chapterId);
    const url = `${this.apiUrl}/${path}`;

    const data = await this.fetchJson<EZManhwaPageListResponse>({
      url,
      method: "GET",
    });

    if (data.requiresPurchase === true) {
      throw new Error("Chapter requires purchase");
    }

    const pages = (data.images ?? []).map((i) => i.url.replace(/ /g, "%20"));

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const slug = this.slugFromId(mangaId);
    return new URLBuilder(this.baseUrl)
      .addPath("series")
      .addPath(slug)
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private isNovel(series: EZManhwaSeries): boolean {
    return (series.type ?? "").toUpperCase() === "NOVEL";
  }

  private buildChapterName(ch: EZManhwaChapter): string {
    const num = ch.number;
    const numStr =
      typeof num === "number" && !isNaN(num)
        ? Number.isInteger(num)
          ? String(num)
          : String(num)
        : "";
    const title = (ch.title ?? "").trim();

    if (!numStr) {
      return title || "Chapter";
    }
    if (!title || title === numStr) {
      return `Chapter ${numStr}`;
    }
    if (/^(chapter|ch\.?|episode|ep\.?)\s*/i.test(title) && title.includes(numStr)) {
      return title;
    }
    if (title.startsWith("-") || title.startsWith(":")) {
      return `Chapter ${numStr} ${title}`;
    }
    return `Chapter ${numStr} - ${title}`;
  }

  private slugFromId(mangaId: string): string {
    return this.safeDecode(mangaId);
  }

  private safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private cleanField(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (!v || v === "-" || v.toLowerCase() === "n/a") return undefined;
    return v;
  }

  private stripHtml(html: string): string {
    if (!html) return "";
    return html
      .replace(/<br\s*\/?>(?=)/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private parseStatus(status: string): string {
    switch (status.toUpperCase()) {
      case "ONGOING":
      case "MASS_RELEASED":
        return "Ongoing";
      case "COMPLETED":
        return "Completed";
      case "DROPPED":
        return "Cancelled";
      case "HIATUS":
        return "Hiatus";
      default:
        return "Unknown";
    }
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
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
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const jsonStr = Application.arrayBufferToUTF8String(data);
    return JSON.parse(jsonStr) as T;
  }
}
