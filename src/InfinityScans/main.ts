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

const BASE_URL = "https://infinityscans.org";
const CDN_HOST = "cv.infinityscans.org";
const PAGE_CDN_HOST = "ch.infinityscans.org";
const SLUG_HASH = "cf675243bcc3";

// Sort values mirrored from the upstream SortType enum.
const SORT_LATEST = "1";
const SORT_POPULARITY = "2";

interface InfinityScansMetadata {
  page?: number;
}

// --- JSON DTO shapes (mirrored from the upstream Kotlin Dto.kt) -------------

interface SearchEntryDto {
  id: string;
  name: string;
  uri: string;
  cover: string;
  authors?: string | null;
  genres?: string | null;
  status?: string | null;
}

interface SearchResultDto {
  titles: SearchEntryDto[];
}

interface ResponseDto<T> {
  result: T;
}

interface ChapterEntryDto {
  groups?: { id: string; name: string }[] | null;
  id: string;
  name: string;
  sequence: string;
  uploaded: string;
}

interface ChapterListDto {
  chapters: ChapterEntryDto[];
  total: number;
}

interface PageEntryDto {
  path: string;
}

class InfinityScansInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "application/json, text/javascript, text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
      "x-requested-with": "XMLHttpRequest",
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

type InfinityScansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class InfinityScansExtension implements InfinityScansImplementation {
  requestManager = new InfinityScansInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
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
    const meta = metadata as InfinityScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? SORT_POPULARITY : SORT_LATEST;

    const url = this.comicsUrl(page, sort);
    const dto = await this.fetchJson<SearchResultDto>({ url, method: "GET" });
    const entries = dto.titles ?? [];

    const items: DiscoverSectionItem[] = entries.map((entry) => {
      const mangaId = this.mangaIdFromEntry(entry);
      return {
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId,
        imageUrl: this.coverUrl(entry.cover),
        title: entry.name,
        metadata: undefined,
      };
    });

    return {
      items,
      metadata: entries.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as InfinityScansMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let entries: SearchEntryDto[];
    let hasNextPage: boolean;

    if (titleQuery === "") {
      // Browse: GET api/comics?page=... (default sort)
      const url = this.comicsUrl(page, "");
      const dto = await this.fetchJson<SearchResultDto>({
        url,
        method: "GET",
      });
      entries = dto.titles ?? [];
      hasNextPage = entries.length > 0;
    } else {
      // Text search: POST api/search { search }. Single (un-paged) result set.
      const dto = await this.fetchJson<ResponseDto<SearchEntryDto[]>>({
        url: `${BASE_URL}/api/search`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ search: titleQuery }),
      });
      entries = dto.result ?? [];
      hasNextPage = false;
    }

    const items: SearchResultItem[] = entries.map((entry) => ({
      mangaId: this.mangaIdFromEntry(entry),
      imageUrl: this.coverUrl(entry.cover),
      title: entry.name,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.idFromMangaId(mangaId);

    // The upstream details endpoint relies on a fragile Next.js RSC payload.
    // We resolve metadata robustly from the search API by id instead.
    const entry = await this.findEntryById(id);

    const genres = (entry?.genres ?? "")
      .split(",")
      .map((g) => g.trim())
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

    const author = (entry?.authors ?? "").trim();

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: entry?.name || this.safeDecode(id),
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(entry?.cover ?? ""),
        author: author || undefined,
        artist: author || undefined,
        synopsis: "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(entry?.status ?? null),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = this.idFromMangaId(sourceManga.mangaId);

    const all: ChapterEntryDto[] = [];
    let total = 0;
    let page = 0;

    // Paginate until we have all chapters (mirrors upstream loop).
    while (page === 0 || all.length < total) {
      const url = `${BASE_URL}/api/comic/${mangaId}/chapters?page=${page}`;
      const dto = await this.fetchJson<ChapterListDto>({ url, method: "GET" });
      total = dto.total ?? 0;
      const chunk = dto.chapters ?? [];
      all.push(...chunk);
      if (chunk.length === 0) break;
      page++;
    }

    return all.map((entry) => ({
      chapterId: this.toSafeId(`comic/${mangaId}/chapter/${entry.id}`),
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: this.parseChapterNumber(entry.name, entry.sequence),
      publishDate: this.parseDate(entry.uploaded),
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = this.safeDecode(chapter.chapterId);
    const url = `${BASE_URL}/api/${path.replace(/^\/+/, "")}`;
    const pageEntries = await this.fetchJson<PageEntryDto[]>({
      url,
      method: "GET",
    });

    const pages: string[] = (pageEntries ?? [])
      .map((p) => `https://${PAGE_CDN_HOST}/${p.path}`)
      .filter((p) => p.length > 0);

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

  private comicsUrl(page: number, sort: string): string {
    const params: string[] = [];
    if (page > 1) params.push(`page=${page}`);
    if (sort) params.push(`sort=${sort}`);
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return `${BASE_URL}/api/comics${query}`;
  }

  private async findEntryById(id: string): Promise<SearchEntryDto | undefined> {
    // Scan the (un-sorted) comics listing for a matching id.
    const dto = await this.fetchJson<SearchResultDto>({
      url: this.comicsUrl(1, ""),
      method: "GET",
    });
    return (dto.titles ?? []).find((t) => t.id === id);
  }

  // mangaId stored in Paperback is `id/slug` (uri after the leading segment).
  private mangaIdFromEntry(entry: SearchEntryDto): string {
    const slug = entry.uri.replace(/^\/+/, "").replace(/^[^/]*\//, "");
    return this.toSafeId(slug);
  }

  private idFromMangaId(mangaId: string): string {
    return this.safeDecode(mangaId).split("/")[0] ?? "";
  }

  private coverUrl(cover: string): string {
    const c = (cover || "").trim();
    if (!c) return "";
    if (c.startsWith("http")) return c;
    return `https://${CDN_HOST}/${c.replace(/^\/+/, "")}`;
  }

  private mangaUrl(mangaId: string): string {
    const id = this.idFromMangaId(mangaId);
    return `${BASE_URL}/comic/${id}-${SLUG_HASH}`;
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

  private parseChapterNumber(name: string, sequence: string): number {
    // Things like prologues mess up the sequence number; prefer "Chapter N".
    const m = (name ?? "").match(/hapter\s+(\d+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1]);
    const seq = parseFloat(sequence);
    return Number.isNaN(seq) ? 0 : seq;
  }

  private parseDate(value: string): Date {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  }

  private parseStatus(status: string | null): string {
    if (!status) return "Unknown";
    const s = status.toLowerCase();
    if (s.includes("ongoing") || s.includes("publishing")) return "Ongoing";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("completed")) return "Completed";
    if (s.includes("dropped") || s.includes("cancelled")) return "Cancelled";
    return "Unknown";
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

export const InfinityScans = new InfinityScansExtension();
