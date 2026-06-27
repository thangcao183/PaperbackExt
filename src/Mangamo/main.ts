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

// ---------------------------------------------------------------------------
// Mangamo is a Firebase/Firestore-backed JSON API (no public HTML browsing).
// We port the upstream keiyoushi extension: an anonymous Firebase user is
// created, exchanged for a Google identity-toolkit idToken, and that bearer
// token authorises Firestore REST queries (Series / chapters collections) and
// the cloud-function page endpoint. Paid/subscriber chapters return 401 from
// the page endpoint; we expose everything publicly readable.
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.mangamo.com";
const FIREBASE_API_KEY = "AIzaSyCU00GBJ4BPSK5owyaXvHZIXwMJ5Rq5F8c";
const FIREBASE_FUNCTION_BASE_PATH =
  "https://us-central1-mangamoapp1.cloudfunctions.net/api";
const FIRESTORE_API_BASE_PATH =
  "https://firestore.googleapis.com/v1/projects/mangamoapp1/databases/(default)/documents";

const SERIES_QUERY_PARAM = "series";
const CHAPTER_QUERY_PARAM = "chapter";
const BROWSE_PAGE_SIZE = 50;

const SERIES_REQUIRED_FIELDS = [
  "id",
  "name",
  "name_lowercase",
  "description",
  "authors",
  "genres",
  "ongoing",
  "releaseStatusTag",
  "titleArt",
];

interface MangamoMetadata {
  page?: number;
}

// Firestore document value shapes -------------------------------------------

interface SeriesFields {
  id?: number;
  authors?: { id?: number; name?: string }[];
  description?: string;
  enabled?: boolean;
  genres?: { id?: number; name?: string }[];
  maxFreeChapterNumber?: number;
  maxMeteredReadingChapterNumber?: number;
  name?: string;
  name_lowercase?: string;
  ongoing?: boolean;
  onlyOnMangamo?: boolean;
  onlyTransactional?: boolean;
  releaseStatusTag?: string;
  titleArt?: string;
  updatedAt?: number;
}

interface ChapterFields {
  id?: number;
  chapterNumber?: number;
  createdAt?: number;
  enabled?: boolean;
  name?: string;
  onlyTransactional?: boolean;
  seriesId?: number;
}

class MangamoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
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

type MangamoImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangamoExtension implements MangamoImplementation {
  requestManager = new MangamoInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // Cached Firebase auth state.
  private userToken = "";
  private idToken = "";
  private refreshToken = "";
  private expirationTime = 0;

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  // ----------------------------------------------------------------
  // Firebase authentication
  // ----------------------------------------------------------------

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 401) {
      throw new Error("You don't have access to this content");
    }
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }

  private async createAnonymousUserToken(): Promise<string> {
    const res = await this.fetchJson<{ localId: string }>({
      url: `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    return res.localId;
  }

  private async obtainInitialIdToken(): Promise<void> {
    if (!this.userToken) {
      this.userToken = await this.createAnonymousUserToken();
    }

    const login = await this.fetchJson<{ accessToken: string }>({
      url: `${FIREBASE_FUNCTION_BASE_PATH}/v3/login`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchaserInfo: { originalAppUserId: this.userToken },
      }),
    });

    const tokenInfo = await this.fetchJson<{
      idToken: string;
      refreshToken: string;
      expiresIn: string | number;
    }>({
      url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: login.accessToken, returnSecureToken: true }),
    });

    this.idToken = tokenInfo.idToken;
    this.refreshToken = tokenInfo.refreshToken;
    this.expireIn(Number(tokenInfo.expiresIn));
  }

  private expireIn(seconds: number): void {
    this.expirationTime = Date.now() + (seconds - 1) * 1000;
  }

  private async refreshIfNecessary(): Promise<void> {
    if (Date.now() <= this.expirationTime) return;

    const [response, data] = await Application.scheduleRequest({
      url: `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${this.refreshToken}`,
    });

    if (response.status === 200) {
      const tokenInfo = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      ) as {
        id_token: string;
        refresh_token: string;
        expires_in: string | number;
      };
      this.idToken = tokenInfo.id_token;
      this.refreshToken = tokenInfo.refresh_token;
      this.expireIn(Number(tokenInfo.expires_in));
    } else {
      await this.obtainInitialIdToken();
    }
  }

  private async getIdToken(): Promise<string> {
    if (!this.idToken) {
      await this.obtainInitialIdToken();
    } else {
      await this.refreshIfNecessary();
    }
    return this.idToken;
  }

  // ----------------------------------------------------------------
  // Firestore query helpers
  // ----------------------------------------------------------------

  private async getDocument<T>(path: string, fields: string[]): Promise<T> {
    const params = fields
      .map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`)
      .join("&");
    const url = `${FIRESTORE_API_BASE_PATH}/${path}${params ? `?${params}` : ""}`;
    const token = await this.getIdToken();
    const raw = await this.fetchJson<Record<string, unknown>>({
      url,
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    return this.reduceFieldsObject(
      (raw["fields"] as Record<string, unknown>) ?? {},
    ) as T;
  }

  private async runQuery<T>(
    fullPath: string,
    opts: {
      fields?: string[];
      filter?: object;
      orderBy?: object[];
      offset?: number;
      limit?: number;
    },
  ): Promise<T[]> {
    const pivot = fullPath.lastIndexOf("/");
    const path = pivot === -1 ? "" : fullPath.substring(0, pivot);
    const collectionId =
      pivot === -1 ? fullPath : fullPath.substring(pivot + 1);

    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId }],
    };
    if (opts.fields && opts.fields.length > 0) {
      structuredQuery["select"] = {
        fields: opts.fields.map((f) => ({ fieldPath: f })),
      };
    }
    if (opts.filter) structuredQuery["where"] = opts.filter;
    if (opts.orderBy) structuredQuery["orderBy"] = opts.orderBy;
    if (opts.offset !== undefined) structuredQuery["offset"] = opts.offset;
    if (opts.limit !== undefined) structuredQuery["limit"] = opts.limit;

    const url = `${FIRESTORE_API_BASE_PATH}/${path}:runQuery`;
    const token = await this.getIdToken();
    const raw = await this.fetchJson<{ document?: { fields?: object } }[]>({
      url,
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ structuredQuery }),
    });

    const results: T[] = [];
    for (const entry of raw) {
      if (!entry || !entry.document || !entry.document.fields) continue;
      results.push(
        this.reduceFieldsObject(
          entry.document.fields as Record<string, unknown>,
        ) as T,
      );
    }
    return results;
  }

  // Firestore wraps every value in a typed container, e.g.
  // {"stringValue":"x"}, {"integerValue":"3"}, {"arrayValue":{"values":[...]}},
  // {"mapValue":{"fields":{...}}}. Reduce that to plain JS values.
  private reduceFieldsObject(
    fields: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) {
      out[key] = this.reduceField(fields[key]);
    }
    return out;
  }

  private reduceField(element: unknown): unknown {
    if (element === null || typeof element !== "object") return element;
    const obj = element as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return null;
    const key = keys[0];
    const value = obj[key];

    switch (key) {
      case "arrayValue": {
        const arr = (value as { values?: unknown[] })?.values ?? [];
        return arr.map((v) => this.reduceField(v));
      }
      case "mapValue": {
        const inner =
          (value as { fields?: Record<string, unknown> })?.fields ?? {};
        return this.reduceFieldsObject(inner);
      }
      case "integerValue":
      case "doubleValue":
        return Number(value);
      case "booleanValue":
        return Boolean(value);
      case "nullValue":
        return null;
      default:
        return value;
    }
  }

  // Firestore structured-query filter builders.
  private fieldFilter(field: string, op: string, value: unknown): object {
    let valueTerm: object;
    if (value === null) {
      valueTerm = { nullValue: null };
    } else if (typeof value === "boolean") {
      valueTerm = { booleanValue: value };
    } else if (typeof value === "number") {
      valueTerm = Number.isInteger(value)
        ? { integerValue: value }
        : { doubleValue: value };
    } else {
      valueTerm = { stringValue: String(value) };
    }
    return {
      fieldFilter: { op, field: { fieldPath: field }, value: valueTerm },
    };
  }

  private andFilter(...filters: object[]): object {
    return { compositeFilter: { op: "AND", filters } };
  }

  // ----------------------------------------------------------------
  // Series mapping
  // ----------------------------------------------------------------

  private seriesUrl(series: SeriesFields): string {
    const lowercaseHyphenated = (series.name_lowercase ?? "").replace(
      / /g,
      "-",
    );
    return `/catalog/${encodeURIComponent(lowercaseHyphenated)}?${SERIES_QUERY_PARAM}=${series.id}`;
  }

  private parseStatus(series: SeriesFields): string {
    switch (series.releaseStatusTag) {
      case "Ongoing":
        return "Ongoing";
      case "series-complete":
      case "Completed":
        return "Completed";
      case "Paused":
        return "Hiatus";
      default:
        return series.ongoing === true ? "Ongoing" : "Unknown";
    }
  }

  private searchItemFromSeries(series: SeriesFields): SearchResultItem | null {
    if (series.id === undefined || !series.name) return null;
    return {
      mangaId: this.seriesUrl(series),
      imageUrl: series.titleArt ?? "",
      title: series.name,
      subtitle: undefined,
      metadata: undefined,
    };
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
    const meta = metadata as MangamoMetadata | undefined;
    const page = meta?.page ?? 1;

    let series: SeriesFields[];
    if (section.id === "latest") {
      series = await this.runQuery<SeriesFields>("Series", {
        fields: [...SERIES_REQUIRED_FIELDS, "enabled"],
        orderBy: [
          { direction: "DESCENDING", field: { fieldPath: "updatedAt" } },
        ],
        offset: (page - 1) * BROWSE_PAGE_SIZE,
        limit: BROWSE_PAGE_SIZE,
      });
      series = series.filter((s) => s.enabled === true);
    } else {
      series = await this.runQuery<SeriesFields>("Series", {
        fields: SERIES_REQUIRED_FIELDS,
        filter: this.andFilter(this.fieldFilter("enabled", "EQUAL", true)),
        offset: (page - 1) * BROWSE_PAGE_SIZE,
        limit: BROWSE_PAGE_SIZE,
      });
    }

    const items: DiscoverSectionItem[] = [];
    for (const s of series) {
      const item = this.searchItemFromSeries(s);
      if (!item) continue;
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
    }

    const hasNext = series.length >= BROWSE_PAGE_SIZE;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangamoMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim().toLowerCase();

    const series = await this.runQuery<SeriesFields>("Series", {
      fields: SERIES_REQUIRED_FIELDS,
      filter: this.andFilter(
        this.fieldFilter("enabled", "EQUAL", true),
        this.fieldFilter("name_lowercase", "GREATER_THAN_OR_EQUAL", titleQuery),
        this.fieldFilter(
          "name_lowercase",
          "LESS_THAN_OR_EQUAL",
          titleQuery + "",
        ),
      ),
      offset: (page - 1) * BROWSE_PAGE_SIZE,
      limit: BROWSE_PAGE_SIZE,
    });

    const items: SearchResultItem[] = [];
    for (const s of series) {
      const item = this.searchItemFromSeries(s);
      if (item) items.push(item);
    }

    const hasNext = series.length >= BROWSE_PAGE_SIZE;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const seriesId = this.seriesIdFromMangaId(mangaId);
    const dto = await this.getDocument<SeriesFields>(
      `Series/${seriesId}`,
      SERIES_REQUIRED_FIELDS,
    );

    const tagGroups: TagSection[] = [];
    const genres = (dto.genres ?? [])
      .map((g) => g?.name ?? "")
      .filter((n) => n.length > 0);
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

    const author = (dto.authors ?? [])
      .map((a) => a?.name ?? "")
      .filter((n) => n.length > 0)
      .join(", ");

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: dto.name ?? this.safeDecode(mangaId),
        secondaryTitles: [],
        thumbnailUrl: dto.titleArt ?? "",
        author: author || undefined,
        artist: author || undefined,
        synopsis: dto.description ?? "",
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(dto),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const seriesId = this.seriesIdFromMangaId(sourceManga.mangaId);

    const series = await this.getDocument<SeriesFields>(`Series/${seriesId}`, [
      "maxFreeChapterNumber",
      "maxMeteredReadingChapterNumber",
      "onlyTransactional",
    ]);

    const chapterDtos = await this.runQuery<ChapterFields>(
      `Series/${seriesId}/chapters`,
      {
        fields: [
          "enabled",
          "id",
          "seriesId",
          "chapterNumber",
          "name",
          "createdAt",
          "onlyTransactional",
        ],
        orderBy: [
          { direction: "DESCENDING", field: { fieldPath: "chapterNumber" } },
        ],
      },
    );

    const maxFree = series.maxFreeChapterNumber ?? 0;
    const maxMetered = series.maxMeteredReadingChapterNumber ?? 0;

    const chapters: Chapter[] = [];
    for (const chapter of chapterDtos) {
      if (chapter.enabled !== true) continue;
      const chapNum = chapter.chapterNumber ?? 0;

      const isFree = chapNum <= maxFree;
      const isMetered = chapNum <= maxMetered;
      const isCoin =
        chapter.onlyTransactional === true ||
        (series.onlyTransactional === true && !isFree);

      let suffix = "";
      if (isCoin) {
        suffix = " 🪙"; // coin emoji
      } else if (isFree) {
        suffix = "";
      } else if (isMetered) {
        suffix = " 🕒"; // metered (clock)
      } else {
        suffix = " 🔒"; // subscriber lock
      }

      chapters.push({
        chapterId: this.chapterIdFor(chapter.seriesId, chapter.id),
        sourceManga,
        title: (chapter.name ?? "") + suffix,
        volume: 0,
        chapNum,
        publishDate: chapter.createdAt
          ? new Date(chapter.createdAt)
          : new Date(0),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { seriesId, chapterId } = this.parseChapterId(chapter.chapterId);
    const token = await this.getIdToken();

    const data = await this.fetchJson<
      { id: number; pageNumber: number; uri: string }[]
    >({
      url: `${FIREBASE_FUNCTION_BASE_PATH}/page/${seriesId}/${chapterId}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });

    const pages = data
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p) => p.uri)
      .filter((u) => !!u);

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
  // Id / URL helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  // mangaId is the relative catalog url e.g. "/catalog/foo?series=123".
  private seriesIdFromMangaId(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    const m = slug.match(/[?&]series=(\d+)/);
    return m ? m[1] : "";
  }

  // chapterId encodes both ids: "?series=1&chapter=2".
  private chapterIdFor(seriesId?: number, chapterId?: number): string {
    return `?${SERIES_QUERY_PARAM}=${seriesId ?? ""}&${CHAPTER_QUERY_PARAM}=${chapterId ?? ""}`;
  }

  private parseChapterId(id: string): {
    seriesId: string;
    chapterId: string;
  } {
    const decoded = this.safeDecode(id);
    const s = decoded.match(/[?&]series=(\d+)/);
    const c = decoded.match(/[?&]chapter=(\d+)/);
    return {
      seriesId: s ? s[1] : "",
      chapterId: c ? c[1] : "",
    };
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
}

export const Mangamo = new MangamoExtension();
