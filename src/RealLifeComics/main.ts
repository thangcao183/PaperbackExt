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
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://reallifecomics.com";
const LOGO = `${BASE_URL}/images/logo.png`;
const AUTHOR = "Maelyn Dean";
const SUMMARY =
  "The normal daily lives of some abnormal people. This entry includes all the chapters published in";

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

class RealLifeComicsInterceptor extends PaperbackInterceptor {
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

type RealLifeComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class RealLifeComicsExtension
  implements RealLifeComicsImplementation
{
  requestManager = new RealLifeComicsInterceptor("main");
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
  // Yearly archive entries
  // ----------------------------------------------------------------

  private currentYear(): number {
    return new Date().getFullYear();
  }

  // The source exposes one entry per yearly archive, mirroring the
  // upstream Kotlin: currentYear down to 1999, skipping 2016-2017.
  private archiveYears(): number[] {
    const years: number[] = [];
    for (let year = this.currentYear(); year >= 1999; year--) {
      if (year >= 2016 && year <= 2017) continue;
      years.push(year);
    }
    return years;
  }

  private mangaFromYear(year: number): SearchResultItem {
    return {
      mangaId: this.toSafeId(`archivepage.php?year=${year}`),
      imageUrl: LOGO,
      title: `Real Life Comics (${year})`,
      subtitle: undefined,
      metadata: undefined,
    };
  }

  private yearFromMangaId(mangaId: string): number | undefined {
    const decoded = this.safeDecode(mangaId);
    const m = decoded.match(/year=(\d+)/);
    return m ? parseInt(m[1], 10) : undefined;
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "archives",
        title: "Yearly Archives",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = this.archiveYears().map((year) => {
      const manga = this.mangaFromYear(year);
      return {
        type: "simpleCarouselItem",
        mangaId: manga.mangaId,
        imageUrl: manga.imageUrl,
        title: manga.title,
        metadata: undefined,
      };
    });
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
    const items: SearchResultItem[] = this.archiveYears()
      .map((year) => this.mangaFromYear(year))
      .filter((manga) => manga.title.toLowerCase().includes(titleQuery));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const year = this.yearFromMangaId(mangaId);
    const title =
      year !== undefined ? `Real Life Comics (${year})` : "Real Life Comics";
    const status =
      year !== undefined && year !== this.currentYear()
        ? "Completed"
        : "Ongoing";
    const synopsis =
      year !== undefined ? `${SUMMARY} ${year}` : SUMMARY;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: LOGO,
        author: AUTHOR,
        artist: AUTHOR,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status,
        tagGroups: [],
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const entries: {
      chapterId: string;
      title: string;
      date: Date;
    }[] = [];
    const seen = new Set<string>();

    $(".calendar tbody tr td a").each((_index, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      // Entries between 1999-2014 do not have dates in the link, but
      // each calendar's preceding sibling holds the "Month Year" heading.
      const monthYear =
        el.closest(".calendar").prev().text().trim() || "";
      const dayText = el.text().trim();
      const rawDate = `${monthYear} ${dayText}`.trim();
      const time = this.parseDate(monthYear, dayText);

      const title =
        time.getTime() !== 0 ? this.formatName(time) : rawDate;

      entries.push({ chapterId, title, date: time });
    });

    return entries.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.title,
      volume: 0,
      chapNum: index,
      publishDate: entry.date,
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    const src = $(".comic img").first().attr("src") || "";
    if (src) pages.push(this.absoluteUrl(src));

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
  // Date helpers (mirror SimpleDateFormat "MMMM yyyy dd" parse and
  // "EEEE, MMM dd, yyyy" formatting from the upstream Kotlin)
  // ----------------------------------------------------------------

  private parseDate(monthYear: string, dayText: string): Date {
    // monthYear is like "January 2024", dayText is the day-of-month.
    const my = monthYear.trim().split(/\s+/);
    if (my.length < 2) return new Date(0);
    const monthName = my[0].toLowerCase();
    const month = MONTHS[monthName];
    const year = parseInt(my[1], 10);
    const day = parseInt(dayText.trim(), 10);
    if (month === undefined || isNaN(year) || isNaN(day)) {
      return new Date(0);
    }
    return new Date(Date.UTC(year, month, day));
  }

  private formatName(date: Date): string {
    const dayName = DAY_NAMES[date.getUTCDay()];
    const monthName = MONTH_NAMES[date.getUTCMonth()];
    const day = date.getUTCDate().toString().padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${dayName}, ${monthName} ${day}, ${year}`;
  }

  // ----------------------------------------------------------------
  // Id / URL helpers
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

  private parsePath(href: string): string {
    const decoded = this.safeDecode(href);
    const slug = decoded.startsWith("http")
      ? decoded.replace(/^https?:\/\/[^/]+\//, "")
      : decoded.replace(/^\/+/, "");
    return this.toSafeId(slug);
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

export const RealLifeComics = new RealLifeComicsExtension();
