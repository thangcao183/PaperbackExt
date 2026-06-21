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

const BASE_URL = "https://akaicomic.org";
const API_URL = `${BASE_URL}/api`;
const PAGE_SIZE = 20;
const FETCH_ALL_SIZE = 100;

interface AkaiComicMetadata {
  page?: number;
}

interface MangaDto {
  id?: string;
  lid?: string;
  series_id?: string;
  series_name?: string;
  name?: string;
  title?: string;
  cover_url?: string;
  cover?: string;
  thumbnail?: string;
  image?: string;
  slug?: string;
  series_slug?: string;
  author?: string;
  artist?: string;
  description?: string;
  genres?: string;
  status?: string;
  type?: string;
  alternative_name?: string;
  alt_name?: string;
  updated_at?: string;
}

interface MangaListResponse {
  manga?: MangaDto[];
  data?: MangaDto[];
  series?: MangaDto[];
  page?: number;
  pageSize?: number;
  page_size?: number;
  total?: number;
}

interface ChapterDto {
  chapter_number: number;
  created_at?: string;
  id: number;
  locked_by_coins?: number;
  manga_id: string;
}

interface ChapterListResponse {
  chapters?: ChapterDto[];
}

interface PageListResponse {
  pages?: string[];
}

class AkaiComicInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json,text/plain,*/*",
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

type AkaiComicImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class AkaiComicExtension implements AkaiComicImplementation {
  requestManager = new AkaiComicInterceptor("main");
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
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as AkaiComicMetadata | undefined;
    const page = meta?.page ?? 1;

    const data = await this.fetchJson<MangaListResponse>(
      `${API_URL}/manga/list?limit=${PAGE_SIZE}&page=${page}`,
    );
    let list = data.manga ?? data.data ?? data.series ?? [];

    if (section.id === "latest") {
      list = [...list].sort((a, b) =>
        (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
      );
    }

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const m of list) {
      const mangaId = this.mangaIdFromDto(m);
      if (!mangaId || seen.has(mangaId)) continue;
      seen.add(mangaId);
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId,
        imageUrl: this.coverFromDto(m),
        title: this.titleFromDto(m),
        metadata: undefined,
      });
    }

    return {
      items,
      metadata: this.hasNextPage(data, page) ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();

    const allManga = await this.fetchAllManga();

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    for (const m of allManga) {
      const title = this.titleFromDto(m);
      if (titleQuery && !title.toLowerCase().includes(titleQuery)) continue;
      const mangaId = this.mangaIdFromDto(m);
      if (!mangaId || seen.has(mangaId)) continue;
      seen.add(mangaId);
      results.push({
        mangaId,
        imageUrl: this.coverFromDto(m),
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    return { items: results, metadata: undefined };
  }

  private async fetchAllManga(): Promise<MangaDto[]> {
    const all: MangaDto[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await this.fetchJson<MangaListResponse>(
        `${API_URL}/manga/list?limit=${FETCH_ALL_SIZE}&page=${page}`,
      );
      const list = data.manga ?? data.data ?? data.series ?? [];
      all.push(...list);
      hasMore = this.hasNextPage(data, page) && list.length > 0;
      page++;
    }
    return all;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const root = await this.fetchJson<unknown>(`${API_URL}/manga/${slug}`);
    const dto = this.extractMangaElement(root);

    const tagGroups: TagSection[] = [];
    const tags: { id: string; title: string }[] = [];
    if (dto.type) tags.push({ id: dto.type, title: dto.type });
    if (dto.genres) {
      for (const g of dto.genres.split(",").map((s) => s.trim())) {
        if (g) tags.push({ id: g.toLowerCase().replace(/\s+/g, "-"), title: g });
      }
    }
    if (tags.length > 0) {
      tagGroups.push({ id: "genres", title: "Genres", tags });
    }

    const altName = dto.alternative_name ?? dto.alt_name;
    let synopsis = dto.description ?? "";
    if (altName) {
      if (synopsis) synopsis += "\n\n";
      synopsis += `Alternative name: ${altName}`;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: this.titleFromDto(dto),
        secondaryTitles: altName ? [altName] : [],
        thumbnailUrl: this.coverFromDto(dto),
        author: dto.author,
        artist: dto.artist,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(dto.status),
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
    const data = await this.fetchJson<ChapterListResponse>(
      `${API_URL}/manga/${slug}/chapters`,
    );

    const chapters: Chapter[] = (data.chapters ?? [])
      .filter((c) => (c.locked_by_coins ?? 0) === 0)
      .map((c) => {
        const chapterId = this.toSafeId(`${c.manga_id}/${c.chapter_number}`);
        return {
          chapterId,
          sourceManga,
          title: `Chapter ${c.chapter_number}`,
          volume: 0,
          chapNum: c.chapter_number,
          publishDate: this.parseDate(c.created_at),
          langCode: "🇬🇧",
        };
      });

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const [mangaId, chapterNum] = decoded.split("/");
    const data = await this.fetchJson<PageListResponse>(
      `${API_URL}/manga/${mangaId}/chapter/${chapterNum}/pages`,
    );

    const pages = (data.pages ?? []).map((path) => this.absoluteUrl(path));

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
    return `${BASE_URL}/serie/${slug.replace(/^\/+/, "")}`;
  }

  private mangaIdFromDto(m: MangaDto): string {
    const id = m.id || m.lid || m.series_id || m.slug || m.series_slug || "";
    return id ? this.toSafeId(id) : "";
  }

  private titleFromDto(m: MangaDto): string {
    const name = m.series_name || m.name || m.title || "";
    if (name) return name;
    const alt = m.alternative_name ?? m.alt_name;
    if (alt) return alt.split(",")[0].trim();
    return "Unknown title";
  }

  private coverFromDto(m: MangaDto): string {
    const cover = m.cover_url || m.cover || m.thumbnail || m.image || "";
    return cover ? this.absoluteUrl(cover) : "";
  }

  private extractMangaElement(root: unknown): MangaDto {
    if (Array.isArray(root)) {
      return (root[0] as MangaDto) ?? {};
    }
    if (root && typeof root === "object") {
      const obj = root as Record<string, unknown>;
      const nested =
        obj["manga"] ?? obj["series"] ?? obj["data"] ?? obj["result"];
      if (Array.isArray(nested)) {
        return (nested[0] as MangaDto) ?? (obj as MangaDto);
      }
      if (nested && typeof nested === "object") {
        return nested as MangaDto;
      }
      return obj as MangaDto;
    }
    return {};
  }

  private hasNextPage(data: MangaListResponse, page: number): boolean {
    const pageSize = data.pageSize ?? data.page_size ?? 0;
    const total = data.total ?? 0;
    if (pageSize <= 0 || total <= 0) return false;
    return page * pageSize < total;
  }

  private parseStatus(status: string | undefined): string {
    switch ((status || "").toUpperCase()) {
      case "ONGOING":
      case "RELEASING":
        return "Ongoing";
      case "COMPLETED":
        return "Completed";
      case "HIATUS":
        return "Hiatus";
      case "CANCELLED":
      case "DROPPED":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseDate(value: string | undefined): Date {
    if (!value) return new Date(0);
    const ms = Date.parse(value);
    return isNaN(ms) ? new Date(0) : new Date(ms);
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

  async fetchJson<T>(url: string): Promise<T> {
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

export const AkaiComic = new AkaiComicExtension();
