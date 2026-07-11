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

const BASE_URL = "https://nuviatoon.com";
const API_URL = `${BASE_URL}/nuvia-api`;
const PER_PAGE = 18;

interface SeriesDto {
  id?: string;
  title?: string;
  slug?: string;
  cover_url?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string[] | null;
}

interface Meta {
  current_page?: number;
  last_page?: number;
}

interface PaginatedResponse {
  data?: SeriesDto[];
  meta?: Meta;
}

interface ChapterDto {
  id?: string;
  title?: string | null;
  number?: number | null;
  created_at?: string | null;
}

interface PageDto {
  image_url?: string;
}

class NuviaToonInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json",
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

type NuviaToonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class NuviaToonExtension implements NuviaToonImplementation {
  requestManager = new NuviaToonInterceptor("main");
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

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "views",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "created_at",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number })?.page ?? 1;
    const url = `${API_URL}/series?per_page=${PER_PAGE}&page=${page}&sort=${section.id}&dir=desc`;
    const response = await this.fetchJson<PaginatedResponse>(url);
    const list = response.data ?? [];

    const items: DiscoverSectionItem[] = [];
    for (const series of list) {
      const parsed = this.itemFromDto(series);
      if (!parsed) continue;
      items.push({
        type:
          section.id === "views"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    }

    return {
      items,
      metadata: this.hasNextPage(response.meta)
        ? { page: page + 1 }
        : undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number })?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let url = `${API_URL}/series?per_page=${PER_PAGE}&page=${page}`;
    if (titleQuery) url += `&q=${encodeURIComponent(titleQuery)}`;
    url += `&sort=views&dir=desc`;

    const response = await this.fetchJson<PaginatedResponse>(url);
    const list = response.data ?? [];

    const items: SearchResultItem[] = [];
    for (const series of list) {
      const parsed = this.itemFromDto(series);
      if (!parsed) continue;
      items.push({
        mangaId: parsed.mangaId,
        title: parsed.title,
        imageUrl: parsed.imageUrl,
        metadata: undefined,
      });
    }

    return {
      items,
      metadata: this.hasNextPage(response.meta)
        ? { page: page + 1 }
        : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const series = await this.fetchJson<SeriesDto>(
      `${API_URL}/series/${slug}`,
    );

    const genres = (series.genres ?? []).filter((g) => g.length > 0);
    const tagGroups: TagSection[] =
      genres.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genres.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title ?? slug,
        secondaryTitles: [],
        thumbnailUrl: series.cover_url ?? "",
        author: series.author ?? undefined,
        artist: series.artist ?? undefined,
        synopsis: series.description ?? "",
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(series.status),
        tagGroups,
        shareUrl: `${BASE_URL}/series/${slug}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const chapters = await this.fetchJson<ChapterDto[]>(
      `${API_URL}/series/${slug}/chapters`,
    );

    const result: Chapter[] = [];
    for (const chap of chapters) {
      if (!chap.id) continue;
      const numberString =
        chap.number != null ? String(chap.number).replace(/\.0$/, "") : "";
      const name = chap.title || `Chapter ${numberString}`.trim();
      result.push({
        chapterId: `${slug}/chapter/${numberString}?id=${chap.id}`,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: chap.number ?? -1,
        publishDate: this.parseDate(chap.created_at),
        langCode: "🇬🇧",
      });
    }
    // Upstream reverses the API order (API returns newest-first data set).
    return result.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const id = decoded.split("id=")[1] ?? "";
    const pageDtos = await this.fetchJson<PageDto[]>(
      `${API_URL}/chapters/${id}/pages`,
    );

    const pages: string[] = [];
    for (const dto of pageDtos) {
      if (dto.image_url) pages.push(dto.image_url);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE_URL}/series/${this.safeDecode(mangaId)}`;
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
  }

  // ---- helpers ----

  private itemFromDto(
    series: SeriesDto,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    if (!series.slug) return undefined;
    return {
      mangaId: this.toSafeId(series.slug),
      imageUrl: series.cover_url ?? "",
      title: series.title ?? series.slug,
    };
  }

  private hasNextPage(meta?: Meta): boolean {
    if (!meta) return false;
    const current = meta.current_page ?? 1;
    const last = meta.last_page ?? current;
    return current < last;
  }

  private parseStatus(status?: string | null): string {
    const s = (status ?? "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    if (s === "hiatus") return "Hiatus";
    if (s === "dropped") return "Cancelled";
    return "Unknown";
  }

  private parseDate(value?: string | null): Date {
    if (!value) return new Date(0);
    const str = value.split(".")[0] + "Z";
    const date = new Date(str);
    return isNaN(date.getTime()) ? new Date(0) : date;
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      return enc !== c
        ? enc
        : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }
}

export const NuviaToon = new NuviaToonExtension();
