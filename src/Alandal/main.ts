import {
  AdvancedSearchForm,
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
import { AlandalSearchForm, AlandalSearchMeta } from "./forms";

const BASE_URL = "https://alandal.com";
const API_URL = "https://qq.alandal.com/api";

interface ResponseDto<T> {
  data: { series: T };
}

interface SearchEntryDto {
  name: string;
  slug: string;
  cover: string;
}

interface SearchSeriesDto {
  current_page: number;
  last_page: number;
  data: SearchEntryDto[];
}

interface NamedObject {
  name: string;
  type?: string;
}

interface MangaDetailsDto {
  name: string;
  summary?: string;
  status?: NamedObject;
  genres?: NamedObject[];
  creators?: NamedObject[];
  cover: string;
}

interface ChapterDto {
  name: string;
  published_at?: string;
  access: boolean;
}

interface ChapterResponseDto {
  data: ChapterDto[];
}

interface PagesResponseDto {
  data: { chapter: { chapter: { pages: string[] } } };
}

class AlandalInterceptor extends PaperbackInterceptor {
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
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

type AlandalImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class AlandalExtension implements AlandalImplementation {
  requestManager = new AlandalInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const sort = section.id === "popular" ? "popular" : "new";
    const url = `${API_URL}/series?type=comic&sort=${sort}&page=${page}`;

    const result = await this.fetchJson<ResponseDto<SearchSeriesDto>>({ url, method: "GET" });
    const series = result.data.series;
    const itemType = section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    const items: DiscoverSectionItem[] = (series.data ?? []).map((s) => ({
      type: itemType,
      mangaId: this.toSafeId(s.slug),
      imageUrl: s.cover,
      title: s.name,
      metadata: undefined,
    }));

    const hasNextPage = series.current_page < series.last_page;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (query.metadata as { searchMeta?: AlandalSearchMeta } | undefined)
      ?.searchMeta;

    let url = `${API_URL}/series?type=comic`;
    if (titleQuery.length > 0) url += `&name=${encodeURIComponent(titleQuery)}`;

    const genres = searchMeta?.genres ?? [];
    if (genres.length > 0) {
      for (const g of genres) url += `&genres=${encodeURIComponent(g)}`;
    } else {
      url += `&genres=-1`;
    }

    const sort = searchMeta?.sort?.[0];
    if (sort && sort.length > 0) url += `&sort=${encodeURIComponent(sort)}`;
    const status = searchMeta?.status?.[0];
    if (status && status.length > 0) url += `&status=${encodeURIComponent(status)}`;

    url += `&page=${page}`;

    const result = await this.fetchJson<ResponseDto<SearchSeriesDto>>({ url, method: "GET" });
    const series = result.data.series;
    const items: SearchResultItem[] = (series.data ?? []).map((s) => ({
      mangaId: this.toSafeId(s.slug),
      imageUrl: s.cover,
      title: s.name,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage = series.current_page < series.last_page;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: AlandalSearchMeta } | undefined)?.searchMeta;
    return new AlandalSearchForm(meta);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const result = await this.fetchJson<ResponseDto<MangaDetailsDto>>({
      url: `${API_URL}/series/${slug}?type=comic`,
      method: "GET",
    });
    const series = result.data.series;

    const genreNames = (series.genres ?? []).map((g) => g.name);
    const tagGroups: TagSection[] =
      genreNames.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genreNames.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    const author = (series.creators ?? [])
      .filter((c) => c.type === "author")
      .map((c) => c.name)
      .join(", ");

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.name,
        secondaryTitles: [],
        thumbnailUrl: series.cover,
        author: author.length > 0 ? author : undefined,
        synopsis: this.stripHtml(series.summary ?? ""),
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(series.status?.name),
        tagGroups,
        shareUrl: `${BASE_URL}/series/comic-${slug}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const result = await this.fetchJson<ChapterResponseDto>({
      url: `${API_URL}/series/${slug}/chapters?type=comic&from=0&to=999`,
      method: "GET",
    });

    const chapters: Chapter[] = (result.data ?? []).map((ch) => {
      const prefix = ch.access ? "" : "[LOCKED] ";
      const num = this.parseChapterNumber(ch.name);
      return {
        chapterId: this.toSafeId(`${slug}#${ch.name}`),
        sourceManga,
        title: `${prefix}Chapter ${ch.name}`,
        volume: 0,
        chapNum: num,
        publishDate: this.parseDate(ch.published_at),
        langCode: "\ud83c\uddec\ud83c\udde7",
      };
    });

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if ((chapter.title ?? "").startsWith("[LOCKED]")) {
      throw new Error("Log in and unlock chapter in webview, then refresh chapter list");
    }
    const decoded = this.safeDecode(chapter.chapterId);
    const [slug, chapterName] = decoded.split("#");
    const result = await this.fetchJson<PagesResponseDto>({
      url: `${API_URL}/series/${slug}/chapters/${chapterName}?type=comic&traveler=0`,
      method: "GET",
    });

    const pages = result.data.chapter.chapter.pages ?? [];

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/series/comic-${this.safeDecode(mangaId)}`;
  }

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

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private parseStatus(status?: string): string {
    const s = (status ?? "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    return "Unknown";
  }

  private parseChapterNumber(name: string): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : -1;
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date(0) : d;
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
}

export const Alandal = new AlandalExtension();
