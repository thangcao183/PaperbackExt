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

const BASE_URL = "https://vortexscans.org";
const API_URL = "https://api.vortexscans.org";

const SERIES_PATH_SEGMENT = "series";
const PER_PAGE = 18;

const POPULAR_ORDER_BY = "totalViews";
const LATEST_ORDER_BY = "lastChapterAddedAt";
const ORDER_DESC = "desc";

// Genre options ported from upstream Constants.kt (name -> id).
const GENRE_OPTIONS: { title: string; id: string }[] = [
  { title: "Action", id: "1" },
  { title: "Drama", id: "2" },
  { title: "Shounen", id: "3" },
  { title: "Sports", id: "4" },
  { title: "Manhwa", id: "5" },
  { title: "Martial Arts", id: "6" },
  { title: "Comedy", id: "7" },
  { title: "Fantasy", id: "8" },
  { title: "Horror", id: "9" },
  { title: "Seinen", id: "10" },
  { title: "Supernatural", id: "11" },
  { title: "Mature", id: "12" },
  { title: "Adventure", id: "13" },
  { title: "Monsters", id: "14" },
  { title: "System", id: "15" },
  { title: "Reincarnation", id: "16" },
  { title: "Revenge", id: "17" },
  { title: "Slice Of Life", id: "18" },
  { title: "Historical", id: "19" },
  { title: "Romance", id: "20" },
  { title: "Josei", id: "21" },
  { title: "Shoujo", id: "22" },
  { title: "School Life", id: "23" },
  { title: "terror", id: "24" },
  { title: "elf", id: "25" },
  { title: "shojo", id: "26" },
  { title: "Video Games", id: "27" },
  { title: "Fantas", id: "28" },
  { title: "WEB COMIC", id: "29" },
  { title: "Webtoons", id: "30" },
  { title: "Murim", id: "31" },
  { title: "Restaurant", id: "32" },
  { title: "Webtoon", id: "33" },
  { title: "+100 Chapter", id: "34" },
  { title: "Tower", id: "35" },
  { title: "Legendary", id: "36" },
  { title: "Dungeons", id: "37" },
  { title: "bully", id: "38" },
  { title: "orphan", id: "39" },
  { title: "Sci-Fi", id: "40" },
  { title: "Gore", id: "41" },
  { title: "Isekai", id: "42" },
  { title: "magic", id: "43" },
  { title: "blood", id: "44" },
  { title: "war", id: "45" },
  { title: "magic and sword", id: "46" },
  { title: "academy", id: "47" },
  { title: "violence", id: "48" },
  { title: "Harem", id: "49" },
  { title: "Myth", id: "50" },
  { title: "OverpoweredMC", id: "51" },
  { title: "TerritoryManagement", id: "52" },
  { title: "Swordsman", id: "53" },
  { title: "Necromancer", id: "54" },
  { title: "Mage", id: "55" },
  { title: "JackOfAllTrades", id: "56" },
  { title: "Artifacts", id: "57" },
  { title: "CharacterGrowth", id: "58" },
  { title: "Mercenary", id: "59" },
  { title: "Elementals", id: "60" },
  { title: "Genius", id: "61" },
  { title: "Psychological", id: "62" },
  { title: "Tragedy", id: "63" },
  { title: "Gender Bender", id: "64" },
];

interface VortexScansMetadata {
  page?: number;
}

interface VortexSearchMeta {
  genre?: string;
}

// ---------------------------------------------------------------- API DTOs

interface GenreDto {
  name?: string;
}

interface PostSummaryDto {
  id: number;
  slug: string;
  postTitle: string;
  featuredImage?: string | null;
  seriesStatus?: string | null;
  genres?: GenreDto[];
}

interface SearchResponseDto {
  posts?: PostSummaryDto[];
  totalCount?: number;
}

interface PostChapterDto {
  id: number;
  slug: string;
  number?: unknown;
  title?: string | null;
  createdAt?: string;
  isLocked?: boolean | null;
  isAccessible?: boolean | null;
}

interface PostDto {
  id: number;
  slug: string;
  postTitle: string;
  postContent?: string | null;
  alternativeTitles?: string | null;
  author?: string | null;
  artist?: string | null;
  featuredImage?: string | null;
  seriesType?: string | null;
  seriesStatus?: string | null;
  genres?: GenreDto[];
  chapters?: PostChapterDto[];
}

interface PostResponseDto {
  post: PostDto;
}

interface ChapterImageDto {
  url: string;
  order?: number | null;
}

interface ChapterDto {
  isLocked?: boolean | null;
  isAccessible?: boolean | null;
  images?: ChapterImageDto[];
}

interface ChapterResponseDto {
  chapter: ChapterDto;
}

class VortexScansInterceptor extends PaperbackInterceptor {
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

type VortexScansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class VortexScansExtension implements VortexScansImplementation {
  requestManager = new VortexScansInterceptor("main");
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
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { searchMeta: { genre: g.id } },
        },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as VortexScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const orderBy =
      section.id === "popular" ? POPULAR_ORDER_BY : LATEST_ORDER_BY;

    const url = this.queryUrl({
      page,
      query: "",
      orderBy,
      orderDirection: ORDER_DESC,
    });
    const payload = await this.fetchJson<SearchResponseDto>(url);

    const posts = payload.posts ?? [];
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const post of posts) {
      const parsed = this.summaryToItem(post);
      if (!parsed || seen.has(parsed.mangaId)) continue;
      seen.add(parsed.mangaId);
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

    const hasNext = (payload.totalCount ?? 0) > page * PER_PAGE;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as VortexScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const searchMeta = (
      query.metadata as { searchMeta?: VortexSearchMeta } | undefined
    )?.searchMeta;

    const url = this.queryUrl({
      page,
      query: titleQuery,
      genreInclude: searchMeta?.genre,
    });
    const payload = await this.fetchJson<SearchResponseDto>(url);

    const posts = payload.posts ?? [];
    const results: SearchResultItem[] = [];
    for (const post of posts) {
      const parsed = this.summaryToItem(post);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = (payload.totalCount ?? 0) > page * PER_PAGE;
    return {
      items: results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const postId = await this.resolvePostId(mangaId);
    const url = this.postUrl(postId);
    const payload = await this.fetchJson<PostResponseDto>(url);
    const post = payload.post;

    const title = post.postTitle.trim() || this.slugFromId(mangaId);

    const genreTitles = (post.genres ?? [])
      .map((g) => (g.name || "").trim())
      .filter((g) => g.length > 0);

    const seriesTypeTag = this.seriesTypeLabel(post.seriesType);
    if (seriesTypeTag && !genreTitles.includes(seriesTypeTag)) {
      genreTitles.unshift(seriesTypeTag);
    }

    const tagGroups: TagSection[] = [];
    if (genreTitles.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreTitles.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: this.parseAlternativeTitles(post.alternativeTitles),
        thumbnailUrl: this.absoluteUrl(post.featuredImage || ""),
        author: (post.author || "").trim() || undefined,
        artist: (post.artist || "").trim() || undefined,
        synopsis: this.buildSynopsis(post.postContent),
        contentRating: ContentRating.EVERYONE,
        status: this.mapStatus(post.seriesStatus),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const postId = await this.resolvePostId(sourceManga.mangaId);
    const url = this.postUrl(postId);
    const payload = await this.fetchJson<PostResponseDto>(url);
    const post = payload.post;
    const mangaSlug = post.slug;

    const chapters: Chapter[] = [];
    for (const ch of post.chapters ?? []) {
      const accessible = ch.isAccessible !== false && ch.isLocked !== true;
      if (!accessible) continue;

      const rawNumber = this.chapterNumberText(ch);
      const chapNum = parseFloat(rawNumber);

      const titleParts: string[] = [];
      titleParts.push(rawNumber ? `Chapter ${rawNumber}` : "Chapter");
      const chapterTitle = (ch.title || "").trim();
      if (chapterTitle) titleParts.push(chapterTitle);

      const chapterId = this.toSafeId(`${mangaSlug}/${ch.slug}#${ch.id}`);

      chapters.push({
        chapterId,
        sourceManga,
        title: titleParts.join(" - "),
        volume: 0,
        chapNum: isNaN(chapNum) ? 0 : chapNum,
        publishDate: this.parseDate(ch.createdAt),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = await this.resolveChapterId(chapter.chapterId);
    const url = this.chapterUrl(chapterId);
    const payload = await this.fetchJson<ChapterResponseDto>(url);
    const ch = payload.chapter;

    if (ch.isAccessible === false || ch.isLocked === true) {
      throw new Error("Unlock chapter in WebView");
    }

    const images = [...(ch.images ?? [])].sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    );

    const pages: string[] = [];
    for (const img of images) {
      const u = this.absoluteUrl(img.url);
      if (u) pages.push(u);
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
  // URL builders (API)
  // ----------------------------------------------------------------

  private queryUrl(opts: {
    page: number;
    query: string;
    orderBy?: string;
    orderDirection?: string;
    genreInclude?: string;
  }): string {
    const params: string[] = [];
    params.push(`page=${opts.page}`);
    params.push(`perPage=${PER_PAGE}`);
    params.push(`searchTerm=${encodeURIComponent(opts.query)}`);
    if (opts.genreInclude) {
      params.push(`genreIds=${encodeURIComponent(opts.genreInclude)}`);
    }
    if (opts.orderBy) {
      params.push(`orderBy=${encodeURIComponent(opts.orderBy)}`);
    }
    if (opts.orderDirection) {
      params.push(`orderDirection=${encodeURIComponent(opts.orderDirection)}`);
    }
    return `${API_URL}/api/query?${params.join("&")}`;
  }

  private postUrl(postId: number): string {
    return `${API_URL}/api/post?postId=${postId}`;
  }

  private chapterUrl(chapterId: number): string {
    return `${API_URL}/api/chapter?chapterId=${chapterId}`;
  }

  // ----------------------------------------------------------------
  // Id resolution
  // ----------------------------------------------------------------

  // mangaId encodes "slug#id". Returns the embedded post id, or resolves by slug.
  private async resolvePostId(mangaId: string): Promise<number> {
    const decoded = this.safeDecode(mangaId);
    const embedded = decoded.split("#")[1];
    const parsed = embedded ? parseInt(embedded, 10) : NaN;
    if (!isNaN(parsed)) return parsed;

    const slug = this.slugFromId(mangaId);
    const summary = await this.findPostBySlug(slug);
    if (!summary) throw new Error("Unable to resolve series id");
    return summary.id;
  }

  // chapterId encodes "mangaSlug/chapterSlug#id".
  private async resolveChapterId(chapterId: string): Promise<number> {
    const decoded = this.safeDecode(chapterId);
    const beforeHash = decoded.split("#")[0];
    const embedded = decoded.split("#")[1];
    const parsed = embedded ? parseInt(embedded, 10) : NaN;
    if (!isNaN(parsed)) return parsed;

    const segments = beforeHash.split("/").filter((s) => s.length > 0);
    if (segments.length < 2) throw new Error("Unable to resolve chapter id");
    const mangaSlug = segments[segments.length - 2];
    const chapterSlug = segments[segments.length - 1];

    const summary = await this.findPostBySlug(mangaSlug);
    if (!summary) throw new Error("Unable to resolve series id");

    const payload = await this.fetchJson<PostResponseDto>(
      this.postUrl(summary.id),
    );
    const chapterDto = (payload.post.chapters ?? []).find(
      (c) => c.slug === chapterSlug,
    );
    if (!chapterDto) throw new Error("Unable to resolve chapter id");
    return chapterDto.id;
  }

  private async findPostBySlug(
    slug: string,
  ): Promise<PostSummaryDto | undefined> {
    const normalizedSlug = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    const terms = this.buildSlugSearchTerms(normalizedSlug);

    for (const term of terms) {
      try {
        const payload = await this.fetchJson<SearchResponseDto>(
          this.queryUrl({ page: 1, query: term }),
        );
        const post = (payload.posts ?? []).find(
          (p) => p.slug.toLowerCase() === normalizedSlug,
        );
        if (post) return post;
      } catch {
        // try next term
      }
    }
    return undefined;
  }

  private buildSlugSearchTerms(slug: string): string[] {
    const withSpaces = slug.replace(/-/g, " ");
    const withoutApostrophe = withSpaces.replace(/'/g, " ");
    const collapsed = withoutApostrophe.replace(/\s+/g, " ");
    const candidates = [withSpaces, withoutApostrophe, collapsed, slug]
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return [...new Set(candidates)];
  }

  // ----------------------------------------------------------------
  // Mapping helpers
  // ----------------------------------------------------------------

  private summaryToItem(
    post: PostSummaryDto,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const title = (post.postTitle || "").trim();
    if (!title) return undefined;
    const mangaId = this.toSafeId(`${post.slug}#${post.id}`);
    return {
      mangaId,
      imageUrl: this.absoluteUrl(post.featuredImage || ""),
      title,
    };
  }

  private chapterNumberText(ch: PostChapterDto): string {
    const raw = this.numberToString(ch.number);
    if (raw) return raw;
    const fromSlug = ch.slug.split("chapter-")[1] || "";
    return fromSlug.trim();
  }

  private numberToString(value: unknown): string {
    if (typeof value === "number") return value.toString();
    if (typeof value === "string") return value.trim();
    return "";
  }

  private parseAlternativeTitles(alt: string | null | undefined): string[] {
    if (!alt) return [];
    return alt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private buildSynopsis(content: string | null | undefined): string {
    if (!content) return "";
    const withBreaks = content
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    return this.decodeHtmlEntities(withBreaks).trim();
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  private seriesTypeLabel(seriesType: string | null | undefined): string {
    switch ((seriesType || "").toUpperCase()) {
      case "MANGA":
        return "Manga";
      case "MANHUA":
        return "Manhua";
      case "MANHWA":
        return "Manhwa";
      default:
        return "";
    }
  }

  private mapStatus(status: string | null | undefined): string {
    switch ((status || "").toUpperCase()) {
      case "ONGOING":
      case "COMING_SOON":
      case "MASS_RELEASED":
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

  private parseDate(raw: string | null | undefined): Date {
    if (!raw) return new Date(0);
    const t = Date.parse(raw);
    return isNaN(t) ? new Date(0) : new Date(t);
  }

  // ----------------------------------------------------------------
  // Public URL helpers (for sharing)
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.slugFromId(mangaId);
    return `${BASE_URL}/${SERIES_PATH_SEGMENT}/${slug}`;
  }

  private slugFromId(id: string): string {
    const decoded = this.safeDecode(id);
    const beforeHash = decoded.split("#")[0];
    const segments = beforeHash.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) return beforeHash;
    if (segments.length >= 2 && segments[0] === SERIES_PATH_SEGMENT) {
      return segments[1];
    }
    return segments[0];
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

  private async fetchJson<T>(url: string): Promise<T> {
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

export const VortexScans = new VortexScansExtension();
