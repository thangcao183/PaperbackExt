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
import { MangaHubSearchForm, MangaHubSearchMeta } from "./forms";
import {
  getBaseUrlOverride,
  getUseGenericTitle,
  MangaHubSettingsForm,
} from "./settings";

export interface MangaHubConfig {
  name: string;
  baseUrl: string;
  mangaSource: string;
  contentRating?: ContentRating;
  langCode?: string;
}

// Shared backend constants (identical across every MangaHub mirror).
const GRAPHQL_URL = "https://api.mghcdn.com/graphql";
const IMAGE_CDN = "https://imgx.mghcdn.com";
const THUMB_CDN = "https://thumb.mghcdn.com";
const PER_PAGE = 30;
const ACCESS_KEY_STATE = "mangahub.accessKey";

// --- GraphQL response DTOs (subset of keiyoushi MangaHubDto) ---

interface GqlError {
  message?: string;
}

interface MangaHubMangaDto {
  title?: string;
  slug?: string;
  status?: string;
  image?: string;
  author?: string;
  artist?: string;
  genres?: string;
  description?: string;
  alternativeTitle?: string;
  latestChapter?: number;
  chapters?: MangaHubChapterDto[];
}

interface MangaHubChapterDto {
  number: number;
  title?: string;
  date?: string;
}

interface MangaHubSearchRowsDto {
  rows?: MangaHubMangaDto[];
}

interface MangaHubChapterPagesDto {
  pages?: string;
  mangaID?: number;
  number?: number;
  manga?: { slug?: string };
}

interface MangaHubGqlResponse {
  data?: {
    search?: MangaHubSearchRowsDto;
    manga?: MangaHubMangaDto;
    chapter?: MangaHubChapterPagesDto;
  };
  errors?: GqlError[];
}

interface MangaHubPagesPayload {
  p: string;
  i: string[];
}

class MangaHubInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
    private readonly getAccessKey: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    const headers: Record<string, string> = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
      "user-agent": await Application.getDefaultUserAgent(),
      "accept-language": "en-US,en;q=0.5",
    };

    // GraphQL calls require the API key obtained from the mirror site.
    if (request.url.startsWith(GRAPHQL_URL)) {
      headers["content-type"] = "application/json";
      headers["accept"] = "application/json";
      const key = this.getAccessKey();
      if (key) {
        headers["x-mhub-access"] = key;
      }
    } else {
      headers["accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    }

    request.headers = headers;
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

type MangaHubImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaHubExtension implements MangaHubImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly mangaSource: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  private accessKey = "";

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MangaHubInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangaHubConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.mangaSource = config.mangaSource;
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangaHubInterceptor(
      "main",
      () => this.baseUrl,
      () => this.accessKey,
    );
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaHubSettingsForm(this.sourceName, this.defaultBaseUrl);
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();

    // Restore any previously stored access key.
    const stored = Application.getState(ACCESS_KEY_STATE);
    if (typeof stored === "string" && stored.length > 0) {
      this.accessKey = stored;
    }
  }

  // ----------------------------------------------------------------
  // GraphQL transport + API key
  // ----------------------------------------------------------------

  /**
   * Fetches a fresh `mhub_access` key by loading a chapter page on the mirror
   * site and reading the `mhub_access` cookie from the response.
   */
  private async refreshAccessKey(): Promise<void> {
    const random = Math.floor(Math.random() * 2000) + 1000;
    const url = `${this.baseUrl}/chapter/martial-peak/chapter-${random}`;
    const [response] = await Application.scheduleRequest({
      url,
      method: "GET",
    });

    let key = "";
    for (const cookie of response.cookies ?? []) {
      if (cookie.name === "mhub_access" && cookie.value) {
        key = cookie.value;
        break;
      }
    }
    if (!key) {
      for (const cookie of this.cookieStorageInterceptor.cookies) {
        if (cookie.name === "mhub_access" && cookie.value) {
          key = cookie.value;
          break;
        }
      }
    }

    if (key) {
      this.accessKey = key;
      Application.setState(key, ACCESS_KEY_STATE);
    }
  }

  /**
   * Performs a GraphQL query against the shared backend, refreshing the access
   * key and retrying once if the response indicates a rate-limit / api-key
   * error or the key is missing.
   */
  private async graphQL(query: string): Promise<MangaHubGqlResponse> {
    if (!this.accessKey) {
      await this.refreshAccessKey();
    }

    let result = await this.postGraphQL(query);
    if (this.needsKeyRefresh(result)) {
      await this.refreshAccessKey();
      result = await this.postGraphQL(query);
    }

    if (result.errors && result.errors.length > 0) {
      throw new Error(
        result.errors.map((e) => e.message ?? "Unknown error").join("; "),
      );
    }
    return result;
  }

  private async postGraphQL(query: string): Promise<MangaHubGqlResponse> {
    const [response, data] = await Application.scheduleRequest({
      url: GRAPHQL_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const jsonStr = Application.arrayBufferToUTF8String(data);
    try {
      return JSON.parse(jsonStr) as MangaHubGqlResponse;
    } catch {
      return {};
    }
  }

  private needsKeyRefresh(result: MangaHubGqlResponse): boolean {
    if (!this.accessKey) return true;
    if (result.errors && result.errors.length > 0) {
      const joined = result.errors
        .map((e) => e.message ?? "")
        .join(" ")
        .toLowerCase();
      return /rate\s*limit|api\s*key/.test(joined);
    }
    return false;
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
    let order: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        order = "POPULAR";
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        order = "LATEST";
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const rows = await this.runSearch("", "all", order, page);

    const items: DiscoverSectionItem[] = rows.map((row) => ({
      type: itemType,
      mangaId: this.toSafeId(row.slug ?? ""),
      imageUrl: this.thumbUrl(row.image),
      title: row.title ?? "",
      metadata: undefined,
    }));

    const hasNextPage = rows.length === PER_PAGE;
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
      { id: "POPULAR", label: "Popular" },
      { id: "LATEST", label: "Updates" },
      { id: "ALPHABET", label: "A-Z" },
      { id: "NEW", label: "New" },
      { id: "COMPLETED", label: "Completed" },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<MangaHubSearchForm> {
    const meta = (
      query.metadata as { searchMeta?: MangaHubSearchMeta } | undefined
    )?.searchMeta;
    return new MangaHubSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: { id: string; label: string },
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangaHubSearchMeta } | undefined
    )?.searchMeta;

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const sortId = sortingOption?.id ?? "";
    const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
    const order = sortId || filterOrderBy || "POPULAR";
    const genre = (searchMeta?.genre ?? "").trim() || "all";

    const rows = await this.runSearch(titleQuery, genre, order, page);

    const seen = new Set<string>();
    const results: SearchResultItem[] = [];
    for (const row of rows) {
      // Dedup near-identical entries by author+latestChapter+genres.
      const signature = `${row.author ?? ""}|${row.latestChapter ?? ""}|${row.genres ?? ""}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      results.push({
        mangaId: this.toSafeId(row.slug ?? ""),
        imageUrl: this.thumbUrl(row.image),
        title: row.title ?? "",
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNextPage = rows.length === PER_PAGE;
    const reachedPageLimit = page >= MangaHubExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
    };
  }

  private async runSearch(
    queryText: string,
    genre: string,
    order: string,
    page: number,
  ): Promise<MangaHubMangaDto[]> {
    const offset = (page - 1) * PER_PAGE;
    const gql = `{
      search(x:${this.mangaSource},q:${JSON.stringify(queryText)},genre:${JSON.stringify(genre)},mod:${order},offset:${offset}) {
        rows { title author slug image genres latestChapter }
      }
    }`;
    const result = await this.graphQL(gql);
    return result.data?.search?.rows ?? [];
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.slugFromId(mangaId);
    const gql = `{
      manga(x:${this.mangaSource},slug:${JSON.stringify(slug)}) {
        title slug status image author artist genres description alternativeTitle
      }
    }`;
    const result = await this.graphQL(gql);
    const manga = result.data?.manga ?? {};

    const secondaryTitles: string[] = [];
    if (manga.alternativeTitle && manga.alternativeTitle.trim()) {
      secondaryTitles.push(manga.alternativeTitle.trim());
    }

    const genres = (manga.genres ?? "")
      .split(",")
      .map((g) => g.trim())
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

    let synopsis = manga.description ?? "";
    if (manga.alternativeTitle && manga.alternativeTitle.trim()) {
      synopsis = `${synopsis}\n\nAlternative Name: ${manga.alternativeTitle.trim()}`;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.title ?? "",
        secondaryTitles,
        thumbnailUrl: this.thumbUrl(manga.image),
        author: this.cleanField(manga.author),
        artist: this.cleanField(manga.artist),
        synopsis: synopsis.trim(),
        contentRating: this.contentRating,
        status: this.parseStatus(manga.status ?? ""),
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
    const gql = `{
      manga(x:${this.mangaSource},slug:${JSON.stringify(slug)}) {
        slug chapters { number title date }
      }
    }`;
    const result = await this.graphQL(gql);
    const manga = result.data?.manga ?? {};
    const useGeneric = getUseGenericTitle(this.sourceName);

    const list = [...(manga.chapters ?? [])];
    // Source order is ascending; Paperback expects newest first.
    list.reverse();

    const chapters: Chapter[] = [];
    for (const ch of list) {
      const numberString = this.formatNumber(ch.number);
      const chapterId = this.toSafeId(`${slug}/chapter-${numberString}`);

      let title: string;
      if (useGeneric) {
        title = `Chapter ${numberString}`;
      } else if (ch.title && /\d/.test(ch.title)) {
        title = ch.title;
      } else if (ch.title && ch.title.trim()) {
        title = `Chapter ${numberString} - ${ch.title.trim()}`;
      } else {
        title = `Chapter ${numberString}`;
      }

      chapters.push({
        chapterId,
        sourceManga,
        title,
        volume: 0,
        chapNum: ch.number,
        publishDate: this.parseDate(ch.date),
        langCode: this.langCode,
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const parts = decoded.split("/");
    const slug = parts[0];
    const numberSegment = parts[parts.length - 1];
    const number = parseFloat(numberSegment.replace(/^chapter-/, "")) || 0;

    const gql = `{
      chapter(x:${this.mangaSource},slug:${JSON.stringify(slug)},number:${number}) {
        pages mangaID number manga { slug }
      }
    }`;
    const result = await this.graphQL(gql);
    const pagesField = result.data?.chapter?.pages;

    const pages: string[] = [];
    if (pagesField) {
      try {
        const payload = JSON.parse(pagesField) as MangaHubPagesPayload;
        const prefix = payload.p ?? "";
        for (const img of payload.i ?? []) {
          pages.push(`${IMAGE_CDN}/${prefix}${img}`);
        }
      } catch {
        // pages field was not valid JSON; leave empty.
      }
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const slug = this.slugFromId(mangaId);
    return `${this.baseUrl}/manga/${slug}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private thumbUrl(image: string | undefined): string {
    if (!image) return "";
    if (/^https?:\/\//.test(image)) return image;
    return `${THUMB_CDN}/${image}`;
  }

  private formatNumber(num: number): string {
    return Number.isInteger(num) ? String(num) : String(num);
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

  private parseStatus(status: string): string {
    switch (status.toLowerCase()) {
      case "ongoing":
        return "Ongoing";
      case "completed":
        return "Completed";
      default:
        return "Unknown";
    }
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
  }

  // ----------------------------------------------------------------
  // Cloudflare
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
}
