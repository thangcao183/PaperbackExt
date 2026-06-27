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

const BASE_URL = "https://sas-api.fly.dev";
const ARCHIVE_URL = "https://sas.ewanb.me";

const MANGA_ID = "page";
const TITLE = "Solar and Sundry";
const AUTHOR = "Ewan Breakey";
const DESCRIPTION =
  "a sci-fi horror webcomic about life blooming against all odds";
const THUMBNAIL =
  "https://imagedelivery.net/zthi1l8fKrUGB5ig08mq-Q/de292ba7-f164-4f43-ec17-1876a7a44600/public";

interface SasPage {
  page_number: number;
  chapter_number: number;
  image_url: string;
  thumbnail_url: string;
  name: string;
  published_at: string;
}

class SolarAndSundryInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${ARCHIVE_URL}/`,
      origin: ARCHIVE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "image/avif,image/webp,image/*,*/*",
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

type SolarAndSundryImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class SolarAndSundryExtension
  implements SolarAndSundryImplementation
{
  requestManager = new SolarAndSundryInterceptor("main");
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
        id: "comic",
        title: TITLE,
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = [
      {
        type: "featuredCarouselItem",
        mangaId: MANGA_ID,
        imageUrl: THUMBNAIL,
        title: TITLE,
        metadata: undefined,
      },
    ];
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const items: SearchResultItem[] = [];
    if (titleQuery === "" || TITLE.toLowerCase().includes(titleQuery)) {
      items.push({
        mangaId: MANGA_ID,
        imageUrl: THUMBNAIL,
        title: TITLE,
        subtitle: undefined,
        metadata: undefined,
      });
    }
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return {
      mangaId,
      mangaInfo: {
        primaryTitle: TITLE,
        secondaryTitles: [],
        thumbnailUrl: THUMBNAIL,
        author: AUTHOR,
        artist: AUTHOR,
        synopsis: DESCRIPTION,
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
        tagGroups: [],
        shareUrl: ARCHIVE_URL,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const pages = await this.fetchJson<SasPage[]>(`${BASE_URL}/page`);

    const chapters: Chapter[] = pages.map((page) => ({
      chapterId: `page/${page.page_number}`,
      sourceManga,
      title: page.name,
      volume: 0,
      chapNum: page.page_number,
      publishDate: this.parseDate(page.published_at),
      langCode: "🇬🇧",
    }));

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const slug = this.safeDecode(chapter.chapterId).replace(/^\/+/, "");
    const page = await this.fetchJson<SasPage>(`${BASE_URL}/${slug}`);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: page.image_url ? [page.image_url] : [],
    };
  }

  getMangaShareUrl(_mangaId: string): string {
    return ARCHIVE_URL;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseDate(dateStr: string): Date {
    const t = Date.parse(dateStr);
    return isNaN(t) ? new Date(0) : new Date(t);
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
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }

  // ----------------------------------------------------------------
  // Cloudflare
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
}

export const SolarAndSundry = new SolarAndSundryExtension();
