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

const BASE_URL = "https://philiascans.org";
const API_URL = `${BASE_URL}/api`;
const PER_PAGE = 20;

const GENRES: [string, string][] = [
  ["Action", "action"],
  ["Adventure", "adventure"],
  ["Comedy", "comedy"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Gourmet", "gourmet"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Isekai", "isekai"],
  ["Josei", "josei"],
  ["Magic", "magic"],
  ["Martial Arts", "martial-arts"],
  ["Monsters", "monsters"],
  ["Music", "music"],
  ["Mystery", "mystery"],
  ["Psychological", "psychological"],
  ["Regression", "regression"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shoujo", "shoujo"],
  ["Shounen", "shounen"],
  ["Slice of Life", "slice-of-life"],
  ["Supernatural", "supernatural"],
  ["Survival", "survival"],
  ["Tragedy", "tragedy"],
  ["Villainess", "villainess"],
  ["War", "war"],
];

interface PhiliaScansMetadata {
  page?: number;
}

interface SeriesItem {
  slug?: string;
  title?: string;
  coverImageUrl?: string | null;
}

interface SeriesResponse {
  items?: SeriesItem[];
  page?: number;
  totalPages?: number;
}

interface InfoEntry {
  name?: string;
}

interface DetailsResponse {
  title?: string;
  alternativeTitles?: string[] | null;
  synopsis?: string | null;
  coverImageUrl?: string | null;
  status?: string | null;
  genres?: InfoEntry[] | null;
  authors?: InfoEntry[] | null;
  artists?: InfoEntry[] | null;
}

interface ChapterItem {
  number?: string;
  title?: string | null;
  slug?: string;
  publishedAt?: string | null;
  coinPrice?: number | null;
  purchased?: boolean | null;
}

interface ChapterResponse {
  items?: ChapterItem[];
}

interface ViewerPage {
  position?: number;
  url?: string;
  mime?: string;
}

interface ViewerChapter {
  id?: number;
  scrambled?: boolean;
  pages?: ViewerPage[];
}

interface ViewerResponse {
  chapter?: ViewerChapter;
  hasAccess?: boolean;
}

class PhiliaScansInterceptor extends PaperbackInterceptor {
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

type PhiliaScansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class PhiliaScansExtension implements PhiliaScansImplementation {
  requestManager = new PhiliaScansInterceptor("main");
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
        title: "Trending",
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
      const items: DiscoverSectionItem[] = GENRES.map(([name, slug]) => ({
        type: "genresCarouselItem",
        name,
        searchQuery: {
          title: "",
          metadata: { genre: slug },
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as PhiliaScansMetadata | undefined;
    const page = meta?.page ?? 1;

    // popular => orderby=trending, latest => recently updated (empty orderby)
    const params: string[] = [`page=${page}`, `perPage=${PER_PAGE}`];
    if (section.id === "popular") {
      params.push("orderby=trending");
    }
    params.push("order=desc");

    const url = `${API_URL}/manga?${params.join("&")}`;
    const result = await this.fetchJson<SeriesResponse>({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const it of result.items ?? []) {
      const parsed = this.itemToResult(it);
      if (!parsed) continue;
      if (seen.has(parsed.mangaId)) continue;
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

    const hasNext = this.hasNextPage(result);
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as PhiliaScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as { genre?: string } | undefined;

    const params: string[] = [`page=${page}`, `perPage=${PER_PAGE}`];
    if (titleQuery) params.push(`q=${encodeURIComponent(titleQuery)}`);
    if (queryMeta?.genre) {
      params.push(`genres=${encodeURIComponent(queryMeta.genre)}`);
    }
    params.push("order=desc");

    const url = `${API_URL}/manga?${params.join("&")}`;
    const result = await this.fetchJson<SeriesResponse>({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    for (const it of result.items ?? []) {
      const parsed = this.itemToResult(it);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = this.hasNextPage(result);
    return { items: results, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  private itemToResult(
    it: SeriesItem,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const slug = (it.slug || "").trim();
    if (!slug) return undefined;
    const title = (it.title || slug).trim();
    return {
      mangaId: this.toSafeId(slug),
      imageUrl: this.absoluteUrl(it.coverImageUrl || ""),
      title,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const url = `${API_URL}/manga/${slug}`;
    const result = await this.fetchJson<DetailsResponse>({
      url,
      method: "GET",
    });

    const title = (result.title || slug).trim();

    const altTitles = (result.alternativeTitles ?? []).filter(
      (t) => !!t && t.trim().length > 0,
    );

    let synopsis = (result.synopsis || "").trim();
    if (altTitles.length > 0) {
      synopsis +=
        "\n\nAlternative Titles:\n" +
        altTitles.map((t) => `- ${t}`).join("\n");
    }

    const author = (result.authors ?? [])
      .map((a) => a.name || "")
      .filter((n) => n.length > 0)
      .join(", ");
    const artist = (result.artists ?? [])
      .map((a) => a.name || "")
      .filter((n) => n.length > 0)
      .join(", ");

    const genres = (result.genres ?? [])
      .map((g) => g.name || "")
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

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altTitles,
        thumbnailUrl: this.absoluteUrl(result.coverImageUrl || ""),
        author: author || undefined,
        artist: artist || undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(result.status || ""),
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
    const result = await this.fetchJson<ChapterResponse>({
      url,
      method: "GET",
    });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const item of result.items ?? []) {
      const chapSlug = (item.slug || "").trim();
      if (!chapSlug) continue;
      const chapterId = this.toSafeId(`${slug}/${chapSlug}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const number = (item.number || "").trim();
      const isLocked =
        item.purchased === false && (item.coinPrice ?? 0) !== 0;
      const lock = isLocked ? "🔒 " : "";
      const rawTitle = (item.title || "").trim();
      const validTitle =
        rawTitle && rawTitle !== "null" && rawTitle !== number
          ? rawTitle
          : "";
      const name =
        lock +
        (validTitle
          ? `Chapter ${number} - ${validTitle}`
          : `Chapter ${number}`);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(number),
        publishDate: this.parseDate(item.publishedAt),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // chapterId is "<mangaSlug>/<chapterSlug>"
    const decoded = this.safeDecode(chapter.chapterId);
    const parts = decoded.replace(/^\/+/, "").split("/");
    const mangaSlug = parts[0] ?? "";
    const chapterSlug = parts[parts.length - 1] ?? "";
    const url = `${API_URL}/manga/${mangaSlug}/chapters/${chapterSlug}`;
    const result = await this.fetchJson<ViewerResponse>({
      url,
      method: "GET",
    });

    if (result.hasAccess === false) {
      throw new Error(
        "Log in via WebView and purchase this chapter to read it.",
      );
    }

    const rawPages = result.chapter?.pages ?? [];
    const sorted = [...rawPages].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );

    const pages: string[] = [];
    for (const page of sorted) {
      const src = (page.url || "").trim();
      if (!src) continue;
      pages.push(this.absoluteUrl(src));
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

  private hasNextPage(result: SeriesResponse): boolean {
    const page = result.page ?? 1;
    const totalPages = result.totalPages ?? page;
    return page < totalPages;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/series/${slug.replace(/^\/+/, "")}`;
  }

  private parseChapterNumber(name: string): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
  }

  private parseStatus(status: string): string {
    switch (status) {
      case "ON_GOING":
        return "Ongoing";
      case "COMPLETED":
        return "Completed";
      default:
        return "Unknown";
    }
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

export const PhiliaScans = new PhiliaScansExtension();
