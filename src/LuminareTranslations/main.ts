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

const BASE_URL = "https://luminaretranslations.com";
const API_URL = `${BASE_URL}/wp-json/yarnovel/v1`;
const PAGE_SIZE = 24;
const EXCLUDED_TYPES = new Set(["novel", "light_novel", "web_novel"]);

interface LuminareTranslationsMetadata {
  page?: number;
}

interface SearchMeta {
  sort?: string;
  status?: string;
  genre?: string;
}

// ---- JSON API response shapes ----

interface EntryData {
  title: string;
  slug: string;
  type?: string | null;
  cover_image?: string | null;
}

interface EntryResponse {
  data: EntryData[];
  meta: { total: number };
}

interface Details {
  title: string;
  status?: string | null;
  cover_image?: string | null;
  genres?: string[] | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
}

interface DetailsResponse {
  data: Details;
}

interface ChapterData {
  title?: string | null;
  number: number;
  slug: string;
  published_at?: string | null;
}

interface ChapterResponse {
  data: ChapterData[];
}

interface ViewerResponse {
  data: { pages: string[] };
}

interface FilterEntry {
  label?: string;
  name?: string;
  value?: string;
  slug?: string;
}

interface FilterResponse {
  genres?: FilterEntry[];
  tags?: FilterEntry[];
  authors?: FilterEntry[];
  artists?: FilterEntry[];
  statuses?: FilterEntry[];
  sorts?: FilterEntry[];
}

class LuminareTranslationsInterceptor extends PaperbackInterceptor {
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

type LuminareTranslationsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class LuminareTranslationsExtension
  implements LuminareTranslationsImplementation
{
  requestManager = new LuminareTranslationsInterceptor("main");
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
      return this.getGenreSectionItems();
    }

    const meta = metadata as LuminareTranslationsMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? "popular" : "latest";
    const url = this.seriesListUrl(page, "", { sort });

    const result = await this.fetchJson<EntryResponse>(url);
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const entry of result.data ?? []) {
      if (entry.type && EXCLUDED_TYPES.has(entry.type)) continue;
      const parsed = this.itemFromEntry(entry);
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

    const total = result.meta?.total ?? 0;
    const hasNextPage = page * PAGE_SIZE < total;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  private async getGenreSectionItems(): Promise<
    PagedResults<DiscoverSectionItem>
  > {
    const items: DiscoverSectionItem[] = [];
    try {
      const filters = await this.fetchJson<FilterResponse>(
        `${API_URL}/explore/filters`,
      );
      for (const genre of filters.genres ?? []) {
        const name = genre.label ?? genre.name ?? "";
        const slug = genre.value ?? genre.slug ?? "";
        if (!name || !slug) continue;
        items.push({
          type: "genresCarouselItem",
          name,
          searchQuery: {
            title: "",
            metadata: { genre: slug } as Metadata,
          },
          metadata: undefined,
        });
      }
    } catch {
      // filters unavailable; return whatever we have
    }
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as LuminareTranslationsMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const searchMeta = query.metadata as SearchMeta | undefined;
    const url = this.seriesListUrl(page, titleQuery, {
      sort: searchMeta?.sort,
      status: searchMeta?.status,
      genre: searchMeta?.genre,
    });

    const result = await this.fetchJson<EntryResponse>(url);
    const results: SearchResultItem[] = [];
    for (const entry of result.data ?? []) {
      if (entry.type && EXCLUDED_TYPES.has(entry.type)) continue;
      const parsed = this.itemFromEntry(entry);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const total = result.meta?.total ?? 0;
    const hasNextPage = page * PAGE_SIZE < total;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private seriesListUrl(
    page: number,
    query: string,
    opts: { sort?: string; status?: string; genre?: string },
  ): string {
    const params: string[] = [];
    params.push(`page=${page}`);
    params.push(`per_page=${PAGE_SIZE}`);
    params.push(`type=manga`);
    if (query) params.push(`search=${encodeURIComponent(query)}`);
    if (opts.sort) params.push(`sort=${encodeURIComponent(opts.sort)}`);
    if (opts.status) params.push(`status=${encodeURIComponent(opts.status)}`);
    if (opts.genre) params.push(`genres=${encodeURIComponent(opts.genre)}`);
    return `${API_URL}/series?${params.join("&")}`;
  }

  private itemFromEntry(
    entry: EntryData,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    if (!entry.slug || !entry.title) return undefined;
    return {
      mangaId: this.toSafeId(entry.slug),
      imageUrl: this.absoluteUrl(entry.cover_image ?? ""),
      title: entry.title,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const result = await this.fetchJson<DetailsResponse>(
      `${API_URL}/series/${slug}`,
    );
    const details = result.data;

    const genres = (details.genres ?? []).filter((g) => g && g.length > 0);
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
        primaryTitle: details.title || slug,
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(details.cover_image ?? ""),
        author: details.author ?? undefined,
        artist: details.artist ?? undefined,
        synopsis: details.description ?? "",
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(details.status),
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
    const result = await this.fetchJson<ChapterResponse>(
      `${API_URL}/series/${slug}/chapters?per_page=999`,
    );

    const chapters: Chapter[] = (result.data ?? []).map((ch) => {
      const chapterNum =
        ch.number % 1 === 0 ? String(Math.trunc(ch.number)) : String(ch.number);
      const chapterId = this.toSafeId(`${slug}/${ch.slug}`);
      return {
        chapterId,
        sourceManga,
        title: ch.title ?? `Chapter ${chapterNum}`,
        volume: 0,
        chapNum: ch.number,
        publishDate: this.parseDate(ch.published_at),
        langCode: "🇬🇧",
      };
    });

    chapters.sort((a, b) => a.chapNum - b.chapNum);
    chapters.reverse();
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const slug = this.safeDecode(chapter.chapterId);
    const result = await this.fetchJson<ViewerResponse>(
      `${API_URL}/series/${slug}`,
    );

    const pages = (result.data?.pages ?? []).map((url) =>
      this.absoluteUrl(url),
    );

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
      case "dropped":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    const parsed = Date.parse(value);
    return isNaN(parsed) ? new Date(0) : new Date(parsed);
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

export const LuminareTranslations = new LuminareTranslationsExtension();
