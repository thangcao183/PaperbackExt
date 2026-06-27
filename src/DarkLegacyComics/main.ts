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
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://www.darklegacycomics.com";
const THUMB_URL = "https://images2.imgbox.com/5d/d8/BVxRdljH_o.png";
const AUTHOR_NAME = "Arad Kedar (Keydar)";

// 2014-05-12 23:28
const SPECIALS_DATE = 1399926480000;

const ARCHIVE_ID = "archive";
const SPECIALS_ID = "specials/1.php";

const SPECIALS: Record<string, string> = {
  "1": "Looking For Group",
  "2": "Rover",
  "3": "Fan Comic",
};

interface SeriesInfo {
  id: string;
  title: string;
  status: string;
}

const SERIES: SeriesInfo[] = [
  { id: ARCHIVE_ID, title: "Dark Legacy Comics", status: "Ongoing" },
  {
    id: SPECIALS_ID,
    title: "Dark Legacy Comics Specials",
    status: "Completed",
  },
];

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

class DarkLegacyComicsInterceptor extends PaperbackInterceptor {
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

type DarkLegacyComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class DarkLegacyComicsExtension
  implements DarkLegacyComicsImplementation
{
  requestManager = new DarkLegacyComicsInterceptor("main");
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
        id: "comics",
        title: "Dark Legacy Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = SERIES.map((series) => ({
      type: "simpleCarouselItem",
      mangaId: this.toSafeId(series.id),
      imageUrl: THUMB_URL,
      title: series.title,
      metadata: undefined,
    }));
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
    for (const series of SERIES) {
      if (
        titleQuery === "" ||
        series.title.toLowerCase().includes(titleQuery)
      ) {
        items.push({
          mangaId: this.toSafeId(series.id),
          imageUrl: THUMB_URL,
          title: series.title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    }
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const series =
      SERIES.find((s) => s.id === slug) ?? SERIES[0];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: [],
        thumbnailUrl: THUMB_URL,
        author: AUTHOR_NAME,
        artist: AUTHOR_NAME,
        synopsis: "",
        contentRating: ContentRating.EVERYONE,
        status: series.status,
        tagGroups: [],
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);

    if (slug !== ARCHIVE_ID) {
      // Specials: fixed list of chapters.
      return Object.keys(SPECIALS).map((key) => ({
        chapterId: this.toSafeId(`specials/${key}`),
        sourceManga,
        title: SPECIALS[key],
        volume: 0,
        chapNum: parseFloat(key),
        publishDate: new Date(SPECIALS_DATE),
        langCode: "🇬🇧",
      }));
    }

    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    $(".archive_link").each((_index, element) => {
      const el = $(element);
      const index = el.find(".index").first().text().trim();
      if (!index) return;
      const date = this.ownText(el.find(".date").first());
      const title = el.find(".name").first().text().trim();

      chapters.push({
        chapterId: this.toSafeId(index),
        sourceManga,
        title: `#${index}: ${title}`,
        volume: 0,
        chapNum: parseFloat(index),
        publishDate: this.parseDate(date),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $(".comic > img").each((_index, element) => {
      const src = $(element).attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });

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
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
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

  private ownText(node: Cheerio<AnyNode>): string {
    // Text directly inside the element (excluding descendant elements).
    return node.clone().children().remove().end().text().trim();
  }

  private parseDate(date: string): Date {
    const cleaned = (date || "").trim();
    if (!cleaned) return new Date(0);

    // One of the dates is missing the year ("Sep 20" -> 2015-09-20).
    if (cleaned === "Sep 20") return new Date(1442696400000);

    // Format: "MMM dd, yyyy" (e.g. "Sep 20, 2015").
    const m = cleaned.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
    if (m) {
      const month = MONTHS[m[1].toLowerCase()];
      if (month !== undefined) {
        return new Date(Date.UTC(parseInt(m[3], 10), month, parseInt(m[2], 10)));
      }
    }
    return new Date(0);
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

  async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(htmlStr);
    return cheerio.load(dom);
  }
}

export const DarkLegacyComics = new DarkLegacyComicsExtension();
