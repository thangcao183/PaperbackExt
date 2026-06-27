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

const BASE_URL = "https://www.webnovel.com";
const BASE_API_URL = `${BASE_URL}/go/pcm`;
const COVER_BASE_URL = "https://book-pic.webnovel.com";

const QUERY_SEARCH_PATH = "/search/result";
const FILTER_SEARCH_PATH = "/category/categoryAjax";
const CSRF_TOKEN_NAME = "_csrfToken";

const DIGIT_REGEX = /(\d+)/;

// Genre options ported from the upstream Tachiyomi GenreFilter.
const GENRES: { name: string; id: string }[] = [
  { name: "All", id: "0" },
  { name: "Action", id: "60002" },
  { name: "Adventure", id: "60014" },
  { name: "Comedy", id: "60011" },
  { name: "Cooking", id: "60009" },
  { name: "Diabolical", id: "60027" },
  { name: "Drama", id: "60024" },
  { name: "Eastern", id: "60006" },
  { name: "Fantasy", id: "60022" },
  { name: "Harem", id: "60017" },
  { name: "History", id: "60018" },
  { name: "Horror", id: "60015" },
  { name: "Inspiring", id: "60013" },
  { name: "LGBT+", id: "60029" },
  { name: "Magic", id: "60016" },
  { name: "Mystery", id: "60008" },
  { name: "Romance", id: "60003" },
  { name: "School", id: "60007" },
  { name: "Sci-fi", id: "60004" },
  { name: "Slice of Life", id: "60019" },
  { name: "Sports", id: "60023" },
  { name: "Transmigration", id: "60012" },
  { name: "Urban", id: "60005" },
  { name: "Wuxia", id: "60010" },
];

interface WebNovelMetadata {
  page?: number;
  genre?: string;
  sort?: string;
}

class WebNovelInterceptor extends PaperbackInterceptor {
  csrfToken = "";

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    };

    // The API requires the CSRF token (taken from the _csrfToken cookie) to be
    // appended as a query parameter on every /go/pcm request.
    if (
      this.csrfToken &&
      request.url.includes("/go/pcm") &&
      !request.url.includes(`${CSRF_TOKEN_NAME}=`)
    ) {
      const sep = request.url.includes("?") ? "&" : "?";
      request.url = `${request.url}${sep}${CSRF_TOKEN_NAME}=${encodeURIComponent(
        this.csrfToken,
      )}`;
    }

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

type WebNovelImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class WebNovelExtension implements WebNovelImplementation {
  requestManager = new WebNovelInterceptor("main");
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
    this.syncCsrfToken();
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
      const items: DiscoverSectionItem[] = GENRES.filter(
        (g) => g.id !== "0",
      ).map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: g.id } as Metadata,
        },
        name: g.name,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as WebNovelMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "latest" ? "5" : "1";

    const url = this.filterSearchUrl(page, "0", "0", sort);
    const json = await this.fetchJson(url);
    const parsed = this.parseBrowseResponse(json);

    const isFeatured = section.id === "popular";
    const items: DiscoverSectionItem[] = parsed.items.map((m) =>
      isFeatured
        ? {
            type: "featuredCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
          }
        : {
            type: "simpleCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
          },
    );

    return {
      items,
      metadata: parsed.hasNextPage ? { page: page + 1, sort } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const pageMeta = metadata as WebNovelMetadata | undefined;
    const page = pageMeta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    if (titleQuery !== "") {
      const url = `${BASE_API_URL}${QUERY_SEARCH_PATH}?type=manga&pageIndex=${page}&keywords=${encodeURIComponent(
        titleQuery,
      )}`;
      const json = await this.fetchJson(url);
      const parsed = this.parseQuerySearchResponse(json);
      return {
        items: parsed.items.map((m) => ({
          mangaId: m.mangaId,
          imageUrl: m.imageUrl,
          title: m.title,
          subtitle: undefined,
          metadata: undefined,
        })),
        metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
      };
    }

    // Empty text query -> category/filter browse using metadata from the genres
    // discover section (or page-carry metadata).
    const searchMeta = query.metadata as WebNovelMetadata | undefined;
    const genre = searchMeta?.genre ?? pageMeta?.genre ?? "0";
    const sort = searchMeta?.sort ?? pageMeta?.sort ?? "1";

    const url = this.filterSearchUrl(page, genre, "0", sort);
    const json = await this.fetchJson(url);
    const parsed = this.parseBrowseResponse(json);

    return {
      items: parsed.items.map((m) => ({
        mangaId: m.mangaId,
        imageUrl: m.imageUrl,
        title: m.title,
        subtitle: undefined,
        metadata: undefined,
      })),
      metadata: parsed.hasNextPage
        ? { page: page + 1, genre, sort }
        : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const comicId = this.safeDecode(mangaId);
    const url = `${BASE_API_URL}/comic/getComicDetailPage?comicId=${encodeURIComponent(
      comicId,
    )}`;
    const json = await this.fetchJson(url);

    const comic = this.asRecord(this.asRecord(json)["comicInfo"]);

    const title =
      this.asString(comic["comicName"]) || comic["comicId"]?.toString() || comicId;
    const author = this.asString(comic["authorName"]);
    const description = this.asString(comic["description"]);
    const updateCycle = this.asString(comic["updateCycle"]);
    const genre = this.asString(comic["categoryName"]);
    const statusNum = this.asNumber(comic["actionStatus"]);
    const coverUpdatedAt = this.asNumber(comic["CV"]);

    let synopsis = description;
    if (statusNum === 1 && updateCycle.trim() !== "") {
      const cyc = updateCycle.charAt(0).toUpperCase() + updateCycle.slice(1);
      synopsis = `${description}\n\nInformation:\n• ${cyc}`;
    }

    const tagGroups: TagSection[] = [];
    if (genre.trim() !== "") {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: [{ id: genre.toLowerCase().replace(/\s+/g, "-"), title: genre }],
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(comicId, coverUpdatedAt),
        author: author || undefined,
        artist: author || undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(statusNum),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const comicId = this.safeDecode(sourceManga.mangaId);
    const url = `${BASE_API_URL}/comic/getChapterList?comicId=${encodeURIComponent(
      comicId,
    )}`;
    const json = await this.fetchJson(url);

    const root = this.asRecord(json);
    const comic = this.asRecord(root["comicInfo"]);
    const resolvedComicId = this.asString(comic["comicId"]) || comicId;
    const rawChapters = this.asArray(root["comicChapters"]);

    // Upstream reverses the list (oldest -> newest in array, displayed newest first).
    const reversed = [...rawChapters].reverse();

    const chapters: Chapter[] = [];
    for (const raw of reversed) {
      const ch = this.asRecord(raw);
      const chapterLevel = this.asNumber(ch["chapterLevel"]);
      const userLevel = this.asNumber(ch["userLevel"]);
      // isVisible: userLevel >= chapterLevel
      if (userLevel < chapterLevel) continue;

      const chapterId = this.asString(ch["chapterId"]);
      if (!chapterId) continue;
      const name = this.asString(ch["chapterName"]);
      const publishTime = this.asString(ch["publishTime"]);

      const isVip = this.asNumber(ch["isVip"]);
      const price = this.asNumber(ch["price"]);
      const isAuth = this.asNumber(ch["isAuth"]);
      const isPremium = isVip !== 0 || price !== 0;
      const isLocked = isPremium && isAuth !== 1;

      chapters.push({
        chapterId: this.toSafeId(`${resolvedComicId}:${chapterId}`),
        sourceManga,
        title: isLocked ? `🔒 ${name}` : name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseRelativeDate(publishTime),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { comicId, chapterId } = this.parseChapterId(chapter.chapterId);
    // Given a high width value WebNovel returns the highest resolution image.
    const url = `${BASE_API_URL}/comic/getContent?comicId=${encodeURIComponent(
      comicId,
    )}&chapterId=${encodeURIComponent(chapterId)}&width=9999`;
    const json = await this.fetchJson(url);

    const info = this.asRecord(this.asRecord(json)["chapterInfo"]);
    const rawPages = this.asArray(info["chapterPage"]);

    const pages: string[] = [];
    for (const raw of rawPages) {
      const p = this.asRecord(raw);
      const src = this.asString(p["url"]);
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
  // JSON parsing helpers
  // ----------------------------------------------------------------

  private parseBrowseResponse(json: unknown): {
    items: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  } {
    const data = this.unwrap(json);
    const rec = this.asRecord(data);
    const isLast = this.asNumber(rec["isLast"]);
    const rawItems = this.asArray(rec["comicItems"]);

    const items = rawItems
      .map((raw) => {
        const it = this.asRecord(raw);
        const id = this.asString(it["bookId"]) || this.asString(it["comicId"]);
        if (!id) return undefined;
        const title = this.asString(it["bookName"]);
        const coverUpdatedAt = this.asNumber(it["coverUpdateTime"]);
        return {
          mangaId: this.toSafeId(id),
          imageUrl: this.coverUrl(id, coverUpdatedAt),
          title,
        };
      })
      .filter(
        (v): v is { mangaId: string; imageUrl: string; title: string } =>
          v !== undefined,
      );

    return { items, hasNextPage: isLast === 0 };
  }

  private parseQuerySearchResponse(json: unknown): {
    items: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  } {
    const data = this.unwrap(json);
    const rec = this.asRecord(data);
    const comicInfo = this.asRecord(rec["comicInfo"]);
    const isLast = this.asNumber(comicInfo["isLast"]);
    const rawItems = this.asArray(comicInfo["comicItems"]);

    const items = rawItems
      .map((raw) => {
        const it = this.asRecord(raw);
        const id = this.asString(it["comicId"]);
        if (!id) return undefined;
        const title = this.asString(it["bookName"]);
        const coverUpdatedAt = this.asNumber(it["CV"]);
        return {
          mangaId: this.toSafeId(id),
          imageUrl: this.coverUrl(id, coverUpdatedAt),
          title,
        };
      })
      .filter(
        (v): v is { mangaId: string; imageUrl: string; title: string } =>
          v !== undefined,
      );

    return { items, hasNextPage: isLast === 0 };
  }

  // Unwraps the { code, data, msg } response envelope.
  private unwrap(json: unknown): unknown {
    const rec = this.asRecord(json);
    if ("code" in rec && this.asNumber(rec["code"]) !== 0) {
      throw new Error(`Error ${rec["code"]}: ${this.asString(rec["msg"])}`);
    }
    return "data" in rec ? rec["data"] : rec;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private asString(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    return "";
  }

  private asNumber(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const n = parseFloat(value);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  }

  // ----------------------------------------------------------------
  // URL / id helpers
  // ----------------------------------------------------------------

  private filterSearchUrl(
    page: number,
    genre: string,
    bookStatus: string,
    sort: string,
  ): string {
    return (
      `${BASE_API_URL}${FILTER_SEARCH_PATH}?categoryType=2&pageIndex=${page}` +
      `&categoryId=${genre}&bookStatus=${bookStatus}&orderBy=${sort}`
    );
  }

  private coverUrl(comicId: string, coverUpdatedAt: number): string {
    return `${COVER_BASE_URL}/bookcover/${comicId}?imageId=${coverUpdatedAt}&imageMogr2/thumbnail/1024x`;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/comic/${slug.replace(/^\/+/, "")}`;
  }

  private parseChapterId(chapterId: string): {
    comicId: string;
    chapterId: string;
  } {
    const decoded = this.safeDecode(chapterId);
    const idx = decoded.indexOf(":");
    if (idx < 0) return { comicId: decoded, chapterId: "" };
    return {
      comicId: decoded.slice(0, idx),
      chapterId: decoded.slice(idx + 1),
    };
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

  private parseChapterNumber(name: string): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseStatus(status: number): string {
    switch (status) {
      case 1:
        return "Ongoing";
      case 2:
        return "Completed";
      case 3:
        return "Hiatus";
      default:
        return "Unknown";
    }
  }

  // Parses relative dates such as "3 days ago" into an absolute Date.
  private parseRelativeDate(text: string): Date {
    if (!text) return new Date(0);
    if (text.toLowerCase().includes("now")) return new Date();

    const m = text.match(DIGIT_REGEX);
    const number = m ? parseInt(m[1], 10) : NaN;
    if (Number.isNaN(number)) return new Date(0);

    const now = new Date();
    if (text.includes("year")) {
      now.setFullYear(now.getFullYear() - number);
    } else if (text.includes("month")) {
      now.setMonth(now.getMonth() - number);
    } else if (text.includes("day")) {
      now.setDate(now.getDate() - number);
    } else if (text.includes("hour")) {
      now.setHours(now.getHours() - number);
    } else if (text.includes("minute")) {
      now.setMinutes(now.getMinutes() - number);
    } else {
      return new Date(0);
    }
    return now;
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

  private syncCsrfToken(): void {
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      if (cookie.name === CSRF_TOKEN_NAME) {
        this.requestManager.csrfToken = cookie.value;
        return;
      }
    }
  }

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
    this.syncCsrfToken();
  }

  async fetchJson(url: string): Promise<unknown> {
    this.syncCsrfToken();
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str);
  }
}

export const WebNovel = new WebNovelExtension();
