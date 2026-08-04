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
import { IkenSearchForm, IkenSearchMeta } from "./forms";
import {
  getBaseUrlOverride,
  getShowLockedChapters,
  getUseChaptersApi,
  IkenSettingsForm,
  setUseChaptersApi,
} from "./settings";

export interface IkenConfig {
  name: string;
  baseUrl: string;
  apiUrl?: string;
  perPage?: number;
  contentRating?: ContentRating;
  langCode?: string;
}

// --- JSON DTO shapes (subset of the keiyoushi Iken DTOs) ---

interface IkenGenre {
  id: number;
  name: string;
}

interface IkenManga {
  id: number;
  slug: string;
  postTitle: string;
  postContent?: string | null;
  isNovel?: boolean;
  featuredImage?: string | null;
  alternativeTitles?: string | null;
  author?: string | null;
  artist?: string | null;
  seriesType?: string | null;
  seriesStatus?: string | null;
  genres?: IkenGenre[];
}

interface IkenSearchResponse {
  posts: IkenManga[];
  totalCount: number;
}

interface IkenChapter {
  id: number;
  slug: string;
  number: number | string;
  title?: string | null;
  createdAt: string;
  updatedAt?: string;
  chapterStatus: string;
  isLocked?: boolean;
  isTimeLocked?: boolean;
  price?: number | null;
  chapterPurchased?: boolean | null;
  mangaPost?: { slug?: string | null } | null;
}

interface IkenChapterListResponse {
  isNovel?: boolean;
  slug?: string | null;
  id?: number | null;
  chapters: IkenChapter[];
}

interface IkenPostResponse {
  post: IkenChapterListResponse;
  /**
   * Authoritative chapter count. When it disagrees with `post.chapters.length`
   * the embedded list is truncated and the chapters endpoint must be used.
   */
  totalChapterCount?: number | null;
}

interface IkenPageImage {
  url: string;
  order?: number | null;
}

interface IkenPage {
  id?: number | null;
  images: IkenPageImage[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

// The /api/chapter endpoint wraps the page data in a `chapter` envelope:
// `{ "chapter": { "images": [...] } }`.
interface IkenPageResponse {
  chapter?: IkenPage;
}

class IkenInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    // Image hosts (e.g. storage.<domain>) sit behind their own Cloudflare
    // challenge. Sending the JSON `accept` used for the API on an image
    // request is an anomalous, bot-like signal that can trigger a CF
    // challenge. Use a browser-like image accept for image requests.
    const accept = IkenInterceptor.isImageRequest(request.url)
      ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
      : "application/json, text/plain, */*";
    request.headers = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
      "user-agent": await Application.getDefaultUserAgent(),
      accept,
      "accept-language": "en-US,en;q=0.5",
    };
    return request;
  }

  private static isImageRequest(url: string): boolean {
    return /\.(jpe?g|png|webp|gif|avif|bmp|svg|apng)(\?|#|$)/i.test(url);
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

type IkenImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class IkenExtension implements IkenImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly defaultApiUrl: string;
  readonly perPage: number;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  /**
   * Iken sites serve their JSON API from an `api.` sub-domain. When the user
   * overrides the base URL we derive the API URL from it, otherwise we use the
   * configured default.
   */
  get apiUrl(): string {
    const override = getBaseUrlOverride(this.sourceName);
    if (override) {
      return this.deriveApiUrl(override);
    }
    return this.defaultApiUrl;
  }

  requestManager: IkenInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: IkenConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.defaultApiUrl = (config.apiUrl ?? this.deriveApiUrl(config.baseUrl))
      .replace(/\/+$/, "");
    this.perPage = config.perPage ?? 18;
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new IkenInterceptor("main", () => this.baseUrl);
  }

  private deriveApiUrl(baseUrl: string): string {
    const cleaned = baseUrl.replace(/\/+$/, "");
    const match = cleaned.match(/^(https?:\/\/)(.+)$/);
    if (match) {
      return `${match[1]}api.${match[2]}`;
    }
    return cleaned;
  }

  async getSettingsForm(): Promise<Form> {
    return new IkenSettingsForm(this.sourceName, this.defaultBaseUrl);
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
    let orderBy: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        orderBy = "totalViews";
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        orderBy = "lastChapterAddedAt";
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

    const url = new URLBuilder(this.apiUrl)
      .addPath("api")
      .addPath("query")
      .addQuery("page", "1")
      .addQuery("perPage", this.perPage.toString())
      .addQuery("searchTerm", "")
      .addQuery("orderBy", orderBy)
      .build();

    const data = await this.fetchJson<IkenSearchResponse>({
      url,
      method: "GET",
    });

    const items: DiscoverSectionItem[] = [];
    for (const post of data.posts ?? []) {
      if (this.isNovel(post)) continue;
      items.push({
        type: itemType,
        mangaId: this.mangaIdFromPost(post),
        imageUrl: post.featuredImage ?? "",
        title: post.postTitle,
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
      { id: "lastChapterAddedAt", label: "Last Chapter" },
      { id: "totalViews", label: "Views" },
      { id: "createdAt", label: "Added Date" },
      { id: "chaptersCount", label: "Chapters Count" },
      { id: "postTitle", label: "Alphabetical" },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<IkenSearchForm> {
    const meta = (query.metadata as { searchMeta?: IkenSearchMeta } | undefined)
      ?.searchMeta;
    return new IkenSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: { id: string; label: string },
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: IkenSearchMeta } | undefined
    )?.searchMeta;

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const sortId = sortingOption?.id ?? "";
    const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
    const effectiveOrderBy = sortId || filterOrderBy;

    const builder = new URLBuilder(this.apiUrl)
      .addPath("api")
      .addPath("query")
      .addQuery("page", page.toString())
      .addQuery("perPage", this.perPage.toString())
      .addQuery("searchTerm", titleQuery);

    if (effectiveOrderBy) builder.addQuery("orderBy", effectiveOrderBy);
    const status = searchMeta?.status?.[0];
    if (status) builder.addQuery("seriesStatus", status);
    const type = searchMeta?.type?.[0];
    if (type) builder.addQuery("seriesType", type);
    const direction = searchMeta?.orderDirection?.[0];
    if (direction) builder.addQuery("orderDirection", direction);

    const data = await this.fetchJson<IkenSearchResponse>({
      url: builder.build(),
      method: "GET",
    });

    const results: SearchResultItem[] = [];
    for (const post of data.posts ?? []) {
      if (this.isNovel(post)) continue;
      results.push({
        mangaId: this.mangaIdFromPost(post),
        imageUrl: post.featuredImage ?? "",
        title: post.postTitle,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const totalCount = data.totalCount ?? 0;
    const hasNextPage = totalCount > page * this.perPage;
    const reachedPageLimit = page >= IkenExtension.MAX_SEARCH_PAGES;

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
      .addPath("api")
      .addPath("post")
      .addQuery("postSlug", slug)
      .build();

    const data = await this.fetchJson<{ post: IkenManga }>({
      url,
      method: "GET",
    });
    const post = data.post;

    const secondaryTitles: string[] = [];
    if (post.alternativeTitles && post.alternativeTitles.trim()) {
      secondaryTitles.push(post.alternativeTitles.trim());
    }

    const genres: string[] = [];
    switch ((post.seriesType ?? "").toUpperCase()) {
      case "MANGA":
        genres.push("Manga");
        break;
      case "MANHUA":
        genres.push("Manhua");
        break;
      case "MANHWA":
        genres.push("Manhwa");
        break;
    }
    for (const g of post.genres ?? []) {
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
        primaryTitle: post.postTitle,
        secondaryTitles,
        thumbnailUrl: post.featuredImage ?? "",
        author: this.cleanField(post.author),
        artist: this.cleanField(post.artist),
        synopsis: this.stripHtml(post.postContent ?? ""),
        contentRating: this.contentRating,
        status: this.parseStatus(post.seriesStatus ?? ""),
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

    if (getUseChaptersApi(this.sourceName)) {
      const url = new URLBuilder(this.apiUrl)
        .addPath("api")
        .addPath("chapters")
        .addQuery("postId", this.postIdFromId(sourceManga.mangaId))
        .build();
      const data = await this.fetchJson<IkenPostResponse>({
        url,
        method: "GET",
      });
      return this.mapChapters(sourceManga, data.post, slug);
    }

    const url = new URLBuilder(this.apiUrl)
      .addPath("api")
      .addPath("post")
      .addQuery("postSlug", slug)
      .build();
    const data = await this.fetchJson<IkenPostResponse>({
      url,
      method: "GET",
    });

    // The embedded chapter list is sometimes truncated. When the post reports a
    // different authoritative count, latch on the chapters endpoint for good
    // and retry through it (upstream keiyoushi PR #17902).
    const embedded = data.post.chapters ?? [];
    const total = data.totalChapterCount;
    if (typeof total === "number" && total !== embedded.length) {
      setUseChaptersApi(this.sourceName, true);
      return this.getChapters(sourceManga);
    }

    return this.mapChapters(sourceManga, data.post, slug);
  }

  private mapChapters(
    sourceManga: SourceManga,
    post: IkenChapterListResponse,
    fallbackSlug: string,
  ): Chapter[] {
    const showLocked = getShowLockedChapters(this.sourceName);
    const chapters: Chapter[] = [];
    const seriesSlug = post.slug ?? fallbackSlug;

    for (const ch of post.chapters ?? []) {
      // Only PUBLIC chapters. `isAccessible` was dropped upstream as
      // unreliable (keiyoushi PR #18064); locked-ness alone now decides
      // visibility and the lock marker.
      const isPublic = ch.chapterStatus === "PUBLIC";
      const isLocked = this.isChapterLocked(ch);
      if (!isPublic || (isLocked && !showLocked)) continue;

      const chSeriesSlug = ch.mangaPost?.slug ?? seriesSlug;
      const chapterId = this.toSafeId(`/series/${chSeriesSlug}/${ch.slug}#${ch.id}`);

      const prefix = isLocked ? "🔒 " : "";
      const suffix = ch.title && ch.title.trim() ? ` - ${ch.title.trim()}` : "";
      const chNum =
        typeof ch.number === "number"
          ? ch.number
          : parseFloat(String(ch.number)) || 0;
      const title = `${prefix}Chapter ${ch.number}${suffix}`;

      chapters.push({
        chapterId,
        sourceManga,
        title,
        volume: 0,
        chapNum: chNum,
        publishDate: this.parseDate(ch.createdAt),
        langCode: this.langCode,
      });
    }

    return chapters;
  }

  /**
   * Mirrors upstream `Chapter.isLocked()`: an explicit lock, a timed lock, or a
   * priced chapter the user has not purchased.
   */
  private isChapterLocked(ch: IkenChapter): boolean {
    if (ch.isLocked === true || ch.isTimeLocked === true) return true;
    const price = ch.price ?? 0;
    return ch.chapterPurchased !== true && price !== 0;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const id = this.chapterApiId(chapter.chapterId);
    const url = new URLBuilder(this.apiUrl)
      .addPath("api")
      .addPath("chapter")
      .addQuery("chapterId", id)
      .build();

    const response = await this.fetchJson<IkenPageResponse>({
      url,
      method: "GET",
    });
    // The API wraps the chapter data in a `chapter` envelope.
    const data = response.chapter ?? (response as unknown as IkenPage);

    if (data.isShortLinkLocked) throw new Error("Chapter locked (short link)");
    if (data.isLockedByCoins) throw new Error("Chapter locked (coins required)");
    if (data.isPermanentlyLocked) throw new Error("Chapter permanently locked");

    const sorted = [...(data.images ?? [])].sort((a, b) => {
      const ao = a.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });

    const pages = sorted
      .map((p) => p.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map((u) => u.replace(/ /g, "%20"));

    if (pages.length === 0) throw new Error("No pages found for this chapter");

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

  private isNovel(post: IkenManga): boolean {
    return (
      post.isNovel === true ||
      (post.seriesType ?? "").toLowerCase() === "novel"
    );
  }

  /**
   * Iken manga IDs encode the slug and numeric post id as `slug#id`. The slug
   * is what the `/api/post` endpoint expects.
   */
  private mangaIdFromPost(post: IkenManga): string {
    return this.toSafeId(`${post.slug}#${post.id}`);
  }

  private slugFromId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    return decoded.split("#")[0];
  }

  /**
   * Manga IDs are stored as `{slug}#{postId}`. The `/api/chapters` endpoint
   * needs the numeric post id after `#`.
   */
  private postIdFromId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    return decoded.substring(decoded.lastIndexOf("#") + 1);
  }

  /**
   * Chapter IDs are stored as `/series/{seriesSlug}/{chapterSlug}#{chapterId}`.
   * The `/api/chapter` endpoint needs the numeric id after `#`.
   */
  private chapterApiId(chapterId: string): string {
    const decoded = this.safeDecode(chapterId);
    return decoded.substring(decoded.lastIndexOf("#") + 1);
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
      case "COMING_SOON":
        return "Ongoing";
      case "COMPLETED":
        return "Completed";
      case "CANCELLED":
      case "DROPPED":
        return "Cancelled";
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
    _request: Request,
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
