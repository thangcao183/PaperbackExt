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

const BASE_URL = "https://manga.uno";
const API_URL = `${BASE_URL}/api`;
const IMG_API_URL = "https://xz7.fstr-cdn.com";
const PAGE_SIZE = 24;

interface MangaDto {
  slug?: string;
  english_title?: string | null;
  japanese_title?: string | null;
  title?: string;
  cover?: string | null;
}

interface ListResponse {
  data?: MangaDto[];
}

interface MangaDetailsDto {
  slug: string;
  english_title?: string | null;
  japanese_title?: string | null;
  title?: string;
  cover?: string | null;
  synopsis?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string | null;
  tags?: string | null;
  status?: string | null;
}

interface ChapterDto {
  id: number;
  chapter_number?: string | null;
  volume?: number | null;
  title?: string | null;
  source?: string | null;
  published_at?: string | null;
}

interface DetailsResponse {
  manga: MangaDetailsDto;
  chapters?: ChapterDto[];
}

interface PageListResponse {
  pages?: string[];
}

class MangaUnoInterceptor extends PaperbackInterceptor {
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

type MangaUnoImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class MangaUnoExtension implements MangaUnoImplementation {
  requestManager = new MangaUnoInterceptor("main");
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
    const page = (metadata as { page?: number })?.page ?? 1;
    const url = `${API_URL}/list/${section.id}?page=${page}&limit=${PAGE_SIZE}`;
    const response = await this.fetchJson<ListResponse>(url);
    const list = response.data ?? [];

    const items: DiscoverSectionItem[] = [];
    for (const manga of list) {
      const parsed = this.itemFromDto(manga);
      if (!parsed) continue;
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

    return {
      items,
      metadata: list.length >= PAGE_SIZE ? { page: page + 1 } : undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number })?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let url = `${API_URL}/search/advanced?page=${page}&limit=${PAGE_SIZE}`;
    if (titleQuery) url += `&title=${encodeURIComponent(titleQuery)}`;

    const response = await this.fetchJson<ListResponse>(url);
    const list = response.data ?? [];

    const items: SearchResultItem[] = [];
    for (const manga of list) {
      const parsed = this.itemFromDto(manga);
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
      metadata: list.length >= PAGE_SIZE ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const response = await this.fetchJson<DetailsResponse>(
      `${API_URL}/manga/${slug}`,
    );
    const manga = response.manga;
    if (!manga) throw new Error("Series not found");

    const genres = this.parseJsonList(manga.genres);
    const tags = this.parseJsonList(manga.tags);
    const allTags = [...genres, ...tags].filter((t) => t.length > 0);

    const tagGroups: TagSection[] =
      allTags.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: allTags.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: this.pickTitle(manga),
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(manga.cover),
        author: manga.author?.replace(/ & /g, ", ") ?? undefined,
        artist: manga.artist?.replace(/ & /g, ", ") ?? undefined,
        synopsis: manga.synopsis ?? "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(manga.status),
        tagGroups,
        shareUrl: `${BASE_URL}/m/${slug}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const response = await this.fetchJson<DetailsResponse>(
      `${API_URL}/manga/${slug}`,
    );
    const chapters = response.chapters ?? [];

    const result: Chapter[] = [];
    for (const chap of chapters) {
      const chNum = chap.chapter_number
        ? parseFloat(chap.chapter_number)
        : NaN;
      const chStr = !isNaN(chNum) ? `Ch. ${String(chNum)}` : undefined;
      const volStr = chap.volume != null ? `Vol. ${chap.volume}` : undefined;
      const title = chap.title
        ? this.unescapeEntities(chap.title.trim())
        : undefined;
      const parts = [chStr, volStr, title].filter(
        (p): p is string => !!p && p.length > 0,
      );
      const name = parts.length > 0 ? parts.join(" — ") : "Chapter";

      result.push({
        chapterId: `${slug}/${chap.id}`,
        sourceManga,
        title: name,
        volume: chap.volume ?? undefined,
        chapNum: !isNaN(chNum) ? chNum : 0,
        publishDate: this.parseDate(chap.published_at),
        langCode: "🇬🇧",
      });
    }
    return result;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const chapterId = decoded.split("/").pop() ?? decoded;
    const response = await this.fetchJson<PageListResponse>(
      `${API_URL}/chapter/${chapterId}`,
    );
    const pages = (response.pages ?? []).filter((p) => !!p);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE_URL}/m/${this.safeDecode(mangaId)}`;
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
    manga: MangaDto,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    if (!manga.slug) return undefined;
    return {
      mangaId: this.toSafeId(manga.slug),
      imageUrl: this.coverUrl(manga.cover),
      title: this.pickTitle(manga),
    };
  }

  private pickTitle(manga: MangaDto | MangaDetailsDto): string {
    const en = (manga.english_title ?? "").trim();
    if (en) return en;
    return manga.title ?? manga.slug ?? "";
  }

  private coverUrl(cover?: string | null): string {
    if (!cover) return "";
    if (cover.startsWith("http")) return cover;
    return `${IMG_API_URL}${cover}`;
  }

  private parseJsonList(raw?: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x));
      }
    } catch {
      /* not JSON */
    }
    return [];
  }

  private parseStatus(status?: string | null): string {
    const s = (status ?? "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancelled")) return "Cancelled";
    return "Unknown";
  }

  private parseDate(value?: string | null): Date {
    if (!value) return new Date(0);
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date(0) : date;
  }

  private unescapeEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
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

export const MangaUno = new MangaUnoExtension();
