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
} from "@paperback/types";

const BASE_URL = "https://readbagabondo.com";
const IMAGE_BASE_URL = "https://pub.moleve.net";

interface ReadVagabondMangaMetadata {
  page?: number;
}

interface MangaDto {
  id: number;
  title: string;
  author: string;
  artist: string;
  description: string;
  status?: string;
  cover: string;
}

interface ChapterDto {
  id: number;
  number: number;
  title: string;
  volume: number | null;
  mangaId: number;
  releaseDate: string;
  pageCount: number;
}

class ReadVagabondMangaInterceptor extends PaperbackInterceptor {
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

type ReadVagabondMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ReadVagabondMangaExtension
  implements ReadVagabondMangaImplementation
{
  requestManager = new ReadVagabondMangaInterceptor("main");
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
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const mangas = await this.fetchJson<MangaDto[]>(
      `${BASE_URL}/api/mihon/mangas`,
    );

    const items: DiscoverSectionItem[] = [];
    for (const manga of mangas) {
      items.push({
        type: "featuredCarouselItem",
        mangaId: String(manga.id),
        imageUrl: this.absoluteUrl(manga.cover),
        title: manga.title,
        metadata: undefined,
      });
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
    const meta = metadata as ReadVagabondMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const params = [
      `q=${encodeURIComponent(titleQuery)}`,
      `page=${page}`,
    ];
    const url = `${BASE_URL}/api/mihon/mangas?${params.join("&")}`;
    const mangas = await this.fetchJson<MangaDto[]>(url);

    const results: SearchResultItem[] = [];
    for (const manga of mangas) {
      results.push({
        mangaId: String(manga.id),
        imageUrl: this.absoluteUrl(manga.cover),
        title: manga.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    return { items: results, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const manga = await this.fetchJson<MangaDto>(
      `${BASE_URL}/api/mihon/mangas/${encodeURIComponent(mangaId)}`,
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.title,
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(manga.cover),
        author: manga.author,
        artist: manga.artist,
        synopsis: manga.description,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(manga.status),
        tagGroups: [],
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const chapters = await this.fetchJson<ChapterDto[]>(
      `${BASE_URL}/api/mihon/mangas/${encodeURIComponent(mangaId)}/chapters`,
    );

    return chapters.map((chapter) => ({
      chapterId: `${mangaId}/${chapter.number}`,
      sourceManga,
      title: chapter.title,
      volume: chapter.volume ?? 0,
      chapNum: chapter.number,
      publishDate: this.parseDate(chapter.releaseDate),
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { mangaId, chapterNumber } = this.parseChapterId(chapter.chapterId);
    const chapterDto = await this.fetchJson<ChapterDto>(
      `${BASE_URL}/api/mihon/mangas/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterNumber)}`,
    );

    const pages: string[] = [];
    for (let page = 1; page <= chapterDto.pageCount; page++) {
      pages.push(
        `${IMAGE_BASE_URL}/chapter-${chapterDto.number}/page-${page}.png`,
      );
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

  private mangaUrl(_mangaId: string): string {
    return BASE_URL;
  }

  private parseChapterId(chapterId: string): {
    mangaId: string;
    chapterNumber: string;
  } {
    const idx = chapterId.lastIndexOf("/");
    if (idx === -1) {
      return { mangaId: chapterId, chapterNumber: "0" };
    }
    return {
      mangaId: chapterId.slice(0, idx),
      chapterNumber: chapterId.slice(idx + 1),
    };
  }

  private parseStatus(status: string | undefined): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    return "Ongoing";
  }

  private parseDate(value: string | undefined): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return isNaN(t) ? new Date(0) : new Date(t);
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
    const jsonStr = Application.arrayBufferToUTF8String(data);
    return JSON.parse(jsonStr) as T;
  }
}

export const ReadVagabondManga = new ReadVagabondMangaExtension();
