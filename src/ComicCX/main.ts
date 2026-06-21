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

const BASE_URL = "https://comic.cx";
const API_URL = `${BASE_URL}/api`;
const PAGE_LIMIT = 100;

interface ComicCXMetadata {
  page?: number;
}

interface Pagination {
  page?: number;
  limit?: number;
  total?: number;
  pages?: number;
}

interface MangaItem {
  id: number;
  title: string;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  cover_image?: string | null;
  genres?: string[] | null;
  slug: string;
  required_tier?: string | null;
  tier?: string | null;
}

interface MangaListResponse {
  manga?: MangaItem[];
  pagination?: Pagination | null;
}

interface ChapterItem {
  id: number;
  chapter_number: number;
  title?: string | null;
  created_at?: string | null;
  pages?: string[];
}

class ComicCXInterceptor extends PaperbackInterceptor {
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

type ComicCXImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ComicCXExtension implements ComicCXImplementation {
  requestManager = new ComicCXInterceptor("main");
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
        id: "popularity",
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
    const meta = metadata as ComicCXMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popularity" ? "popularity" : "latest";

    const url =
      `${API_URL}/manga?limit=${PAGE_LIMIT}&page=${page}&sort=${sort}`;
    const data = await this.fetchJSON<MangaListResponse>({ url, method: "GET" });

    const itemType =
      section.id === "popularity"
        ? "featuredCarouselItem"
        : "simpleCarouselItem";

    const items: DiscoverSectionItem[] = (data.manga ?? []).map((m) => ({
      type: itemType,
      mangaId: this.toSafeId(m.slug),
      imageUrl: this.resolveCoverUrl(m.cover_image),
      title: m.title,
      metadata: undefined,
    }));

    const hasNextPage =
      (data.pagination?.page ?? 1) < (data.pagination?.pages ?? 1);

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ComicCXMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const params: string[] = [];
    params.push(`limit=${PAGE_LIMIT}`);
    params.push(`page=${page}`);
    if (titleQuery) params.push(`search=${encodeURIComponent(titleQuery)}`);

    const url = `${API_URL}/manga?${params.join("&")}`;
    const data = await this.fetchJSON<MangaListResponse>({ url, method: "GET" });

    const items: SearchResultItem[] = (data.manga ?? []).map((m) => ({
      mangaId: this.toSafeId(m.slug),
      imageUrl: this.resolveCoverUrl(m.cover_image),
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage =
      (data.pagination?.page ?? 1) < (data.pagination?.pages ?? 1);

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const url = `${API_URL}/manga/${slug}`;
    const m = await this.fetchJSON<MangaItem>({ url, method: "GET" });

    const tagGroups: TagSection[] = [];
    const genres = (m.genres ?? []).filter((g) => g && g.length > 0);
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

    let synopsis = (m.description ?? "").trim();
    const effectiveTier = m.required_tier ?? m.tier;
    if (
      effectiveTier &&
      effectiveTier !== "free" &&
      effectiveTier !== "tier_0"
    ) {
      const tierLabel = effectiveTier.replace(/_/g, " ").toUpperCase();
      const notice = `⚠ This title requires ${tierLabel} access. Log in via WebView to read.`;
      synopsis = synopsis ? `${synopsis}\n\n${notice}` : notice;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: m.title,
        secondaryTitles: [],
        thumbnailUrl: this.resolveCoverUrl(m.cover_image),
        author: m.author ?? undefined,
        artist: m.artist ?? undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(m.status),
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
    const url = `${API_URL}/manga/${slug}/chapters`;
    const list = await this.fetchJSON<ChapterItem[]>({ url, method: "GET" });

    const sorted = [...list].sort(
      (a, b) => b.chapter_number - a.chapter_number,
    );

    return sorted.map((c) => {
      const chapNumStr = this.formatChapterNumber(c.chapter_number);
      let title = `Chapter ${chapNumStr}`;
      if (c.title && c.title.trim()) title += ` - ${c.title.trim()}`;
      return {
        chapterId: this.toSafeId(`${slug}/${c.id}`),
        sourceManga,
        title,
        volume: 0,
        chapNum: c.chapter_number,
        publishDate: this.parseDate(c.created_at),
        langCode: "🇬🇧",
      };
    });
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const slug = decoded.substring(0, decoded.indexOf("/"));
    const idStr = decoded.substring(decoded.indexOf("/") + 1);
    const id = parseInt(idStr, 10);

    const url = `${API_URL}/manga/${slug}/chapters?chapter_id=${encodeURIComponent(
      idStr,
    )}`;
    const list = await this.fetchJSON<ChapterItem[]>({ url, method: "GET" });

    const target = list.find((c) => c.id === id);
    if (!target) {
      throw new Error("Chapter not found");
    }

    const pages = (target.pages ?? []).map((p) => this.resolveImageUrl(p));

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
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
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

  private formatChapterNumber(n: number): string {
    return Number.isInteger(n) ? String(Math.trunc(n)) : String(n);
  }

  private parseStatus(status: string | null | undefined): string {
    const s = (status ?? "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    return "Unknown";
  }

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
  }

  private resolveImageUrl(src: string | null | undefined): string {
    const s = (src ?? "").trim();
    if (!s) return "";
    if (s.startsWith("/")) return `${BASE_URL}${s}`;
    return s;
  }

  private resolveCoverUrl(src: string | null | undefined): string {
    const s = (src ?? "").trim();
    if (!s) return "";
    if (s.startsWith("data:")) return s;
    if (s.startsWith("/")) return `${BASE_URL}${s}`;
    return s;
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

  async fetchJSON<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

export const ComicCX = new ComicCXExtension();
