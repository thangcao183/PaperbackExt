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
import { MangAdventureSearchForm, MangAdventureSearchMeta } from "./forms";
import { getBaseUrlOverride, MangAdventureSettingsForm } from "./settings";

export interface MangAdventureConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
}

// --- JSON DTO shapes (MangAdventure API v2) ---

interface MASeries {
  slug: string;
  title: string;
  cover: string;
  description?: string | null;
  status?: string | null;
  licensed?: boolean | null;
  aliases?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  categories?: string[] | null;
}

interface MAChapter {
  id: number;
  title: string;
  number: number;
  volume?: number | null;
  published: number | string;
  final: boolean;
  series: string;
  groups: string[];
  full_title: string;
}

interface MAPage {
  id: number;
  image: string;
  number: number;
  url: string;
}

interface MAPaginator<T> {
  last: boolean;
  results: T[];
}

interface MAResults<T> {
  results: T[];
}

class MangAdventureInterceptor extends PaperbackInterceptor {
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

type MangAdventureImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangAdventureExtension implements MangAdventureImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  get apiUrl(): string {
    return `${this.baseUrl}/api/v2`;
  }

  requestManager: MangAdventureInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangAdventureConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangAdventureInterceptor(
      "main",
      () => this.baseUrl,
    );
  }

  async getSettingsForm(): Promise<Form> {
    return new MangAdventureSettingsForm(this.sourceName, this.defaultBaseUrl);
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
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let sort: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        sort = "-views";
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        sort = "-latest_upload";
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const url = new URLBuilder(this.apiUrl)
      .addPath("series")
      .addQuery("page", page.toString())
      .addQuery("sort", sort)
      .build();

    const data = await this.fetchJson<MAPaginator<MASeries>>({
      url,
      method: "GET",
    });

    const items: DiscoverSectionItem[] = (data.results ?? []).map((s) => ({
      type: itemType,
      mangaId: this.toSafeId(s.slug),
      imageUrl: s.cover ?? "",
      title: s.title,
      metadata: undefined,
    }));

    const hasNextPage = data.last === false;
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions() {
    return [
      { id: "-views", label: "Most Views" },
      { id: "-latest_upload", label: "Latest Upload" },
      { id: "title", label: "Title (A-Z)" },
      { id: "-title", label: "Title (Z-A)" },
      { id: "-chapter_count", label: "Chapter Count" },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<MangAdventureSearchForm> {
    const meta = (
      query.metadata as { searchMeta?: MangAdventureSearchMeta } | undefined
    )?.searchMeta;
    return new MangAdventureSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: { id: string; label: string },
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangAdventureSearchMeta } | undefined
    )?.searchMeta;

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const sortId = sortingOption?.id ?? "";
    const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
    const effectiveOrderBy = sortId || filterOrderBy;

    const builder = new URLBuilder(this.apiUrl)
      .addPath("series")
      .addQuery("page", page.toString())
      .addQuery("title", titleQuery);

    if (effectiveOrderBy) builder.addQuery("sort", effectiveOrderBy);
    const author = searchMeta?.author?.trim();
    if (author) builder.addQuery("author", author);
    const artist = searchMeta?.artist?.trim();
    if (artist) builder.addQuery("artist", artist);
    const status = searchMeta?.status?.[0];
    if (status && status !== "any") builder.addQuery("status", status);

    const data = await this.fetchJson<MAPaginator<MASeries>>({
      url: builder.build(),
      method: "GET",
    });

    const results: SearchResultItem[] = (data.results ?? []).map((s) => ({
      mangaId: this.toSafeId(s.slug),
      imageUrl: s.cover ?? "",
      title: s.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage = data.last === false;
    const reachedPageLimit = page >= MangAdventureExtension.MAX_SEARCH_PAGES;

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
    const slug = this.safeDecode(mangaId);
    const url = new URLBuilder(this.apiUrl)
      .addPath("series")
      .addPath(slug)
      .build();

    const series = await this.fetchJson<MASeries>({ url, method: "GET" });

    const secondaryTitles: string[] = [];
    for (const alias of series.aliases ?? []) {
      if (alias && alias.trim()) secondaryTitles.push(alias.trim());
    }

    const tagGroups: TagSection[] = [];
    const categories = (series.categories ?? []).filter((c) => c && c.trim());
    if (categories.length > 0) {
      tagGroups.push({
        id: "categories",
        title: "Categories",
        tags: categories.map((c) => ({
          id: c.toLowerCase().replace(/\s+/g, "-"),
          title: c,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles,
        thumbnailUrl: series.cover ?? "",
        author: this.joinField(series.authors),
        artist: this.joinField(series.artists),
        synopsis: (series.description ?? "").trim(),
        contentRating: this.contentRating,
        status: this.parseStatus(series),
        tagGroups,
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const url = new URLBuilder(this.apiUrl)
      .addPath("series")
      .addPath(slug)
      .addPath("chapters")
      .addQuery("date_format", "timestamp")
      .build();

    const data = await this.fetchJson<MAResults<MAChapter>>({
      url,
      method: "GET",
    });

    const chapters: Chapter[] = [];
    for (const ch of data.results ?? []) {
      const title = `${ch.full_title}${ch.final ? " [END]" : ""}`;
      chapters.push({
        chapterId: String(ch.id),
        sourceManga,
        title,
        volume: ch.volume ?? 0,
        chapNum: ch.number,
        publishDate: this.parseTimestamp(ch.published),
        langCode: this.langCode,
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URLBuilder(this.apiUrl)
      .addPath("chapters")
      .addPath(chapter.chapterId)
      .addPath("pages")
      .addQuery("track", "true")
      .build();

    const data = await this.fetchJson<MAResults<MAPage>>({
      url,
      method: "GET",
    });

    const sorted = [...(data.results ?? [])].sort(
      (a, b) => a.number - b.number,
    );
    const pages = sorted.map((p) => p.image);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    return new URLBuilder(this.baseUrl)
      .addPath("reader")
      .addPath(slug)
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

  private joinField(values: string[] | null | undefined): string | undefined {
    if (!values || values.length === 0) return undefined;
    const joined = values
      .filter((v) => v && v.trim())
      .join(", ")
      .trim();
    return joined.length > 0 ? joined : undefined;
  }

  private parseStatus(series: MASeries): string {
    if (series.licensed === true) return "Completed";
    switch ((series.status ?? "").toLowerCase()) {
      case "completed":
        return "Completed";
      case "ongoing":
        return "Ongoing";
      case "hiatus":
        return "Hiatus";
      case "canceled":
      case "cancelled":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseTimestamp(value: number | string): Date {
    const num = typeof value === "number" ? value : parseInt(value, 10);
    if (!isNaN(num)) {
      // API returns Unix seconds when date_format=timestamp.
      return new Date(num * 1000);
    }
    const direct = new Date(String(value));
    return isNaN(direct.getTime()) ? new Date() : direct;
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
