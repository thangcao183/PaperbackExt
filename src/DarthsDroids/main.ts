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

const BASE_URL = "https://www.darthsanddroids.net";
const NAME = "Darths & Droids";
const AUTHOR = "David Morgan-Mar & Co.";
const GENRE = "Campaign Comic, Comedy, Space Opera, Science Fiction";
const DESCRIPTION = [
  "What if Star Wars as we know it didn't exist, but instead the",
  "plot of the movies was being made up on the spot by players of",
  "a Tabletop Game?",
  "",
  "Well, for one, the results might actually make a lot more sense,",
  "from an out-of-story point of view…",
].join("\n");

// Picks a thumbnail from the profile pictures of the »cast« pages.
// The numbers are assigned in order of appearance of a book on the archive page.
function thumbnailForTitle(nthManga: number): string {
  switch (nthManga) {
    case 0:
      return `${BASE_URL}/cast/QuiGon.jpg`;
    case 1:
      return `${BASE_URL}/cast/Anakin2.jpg`;
    case 2:
      return `${BASE_URL}/cast/ObiWan3.jpg`;
    case 3:
      return `${BASE_URL}/cast/JarJar2.jpg`;
    case 4:
      return `${BASE_URL}/cast/Leia4.jpg`;
    case 5:
      return `${BASE_URL}/cast/Han5.jpg`;
    case 6:
      return `${BASE_URL}/cast/Luke6.jpg`;
    case 7:
      return `${BASE_URL}/cast/Cassian.jpg`;
    case 8:
      return `${BASE_URL}/cast/C3PO4.jpg`;
    case 9:
      return `${BASE_URL}/cast/Finn7.jpg`;
    case 10:
      return `${BASE_URL}/cast/Han4.jpg`;
    case 11:
      return `${BASE_URL}/cast/Hux8.jpg`;
    default:
      return `${BASE_URL}/cast/Vader4.jpg`;
  }
}

// "EEE d MMM, yyyy" (e.g. "Tue 3 Jul, 2007")
const DATE_FMT = /^\s*\w+\s+(\d+)\s+(\w+),\s+(\d+)\s*$/;
// "Published: Tuesday, 3 July, 2007; 00:00:00 PST"
const EXTR_PAGE_DATE = /Published:\s+(\w+,\s+\d+\s+\w+,\s+\d+;\s+\d+:\d+:\d+\s+\w+)/;
const PAGE_DATE_FMT =
  /^\w+,\s+(\d+)\s+(\w+),\s+(\d+);\s+(\d+):(\d+):(\d+)\s+\w+$/;

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

class DarthsDroidsInterceptor extends PaperbackInterceptor {
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

type DarthsDroidsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

interface BookEntry {
  mangaId: string;
  title: string;
  status: string;
  nthManga: number;
}

export class DarthsDroidsExtension implements DarthsDroidsImplementation {
  requestManager = new DarthsDroidsInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 4,
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
        id: "books",
        title: "Books",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const books = await this.fetchBooks();
    const items: DiscoverSectionItem[] = books.map((book) => ({
      type: "simpleCarouselItem",
      mangaId: book.mangaId,
      imageUrl: thumbnailForTitle(book.nthManga),
      title: book.title,
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
    const books = await this.fetchBooks();

    const items: SearchResultItem[] = books
      .filter(
        (book) =>
          titleQuery === "" || book.title.toLowerCase().includes(titleQuery),
      )
      .map((book) => ({
        mangaId: book.mangaId,
        imageUrl: thumbnailForTitle(book.nthManga),
        title: book.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const books = await this.fetchBooks();
    // Do not test for URL-equality, for the last book will always eventually
    // migrate its archive page from `/archive.html` to its own page. Match by
    // title; fall back to the id-derived book if no match is found.
    let book = books.find((b) => b.mangaId === mangaId);
    const slug = this.safeDecode(mangaId);
    if (!book) {
      book = books.find(
        (b) => this.safeDecode(b.mangaId) === slug,
      );
    }

    const title = book?.title ?? NAME;
    const nthManga = book?.nthManga ?? 0;
    const status = book?.status ?? "Ongoing";

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: thumbnailForTitle(nthManga),
        author: AUTHOR,
        artist: AUTHOR,
        synopsis: DESCRIPTION,
        contentRating: ContentRating.EVERYONE,
        status,
        tagGroups: [
          {
            id: "genres",
            title: "Genres",
            tags: GENRE.split(",").map((g) => {
              const t = g.trim();
              return { id: t.toLowerCase().replace(/\s+/g, "-"), title: t };
            }),
          },
        ],
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

    // For books where all pages released the same day, there is no page date
    // column, so instead we grab the release date of the archive page itself
    // from its footer.
    let pageDate = 0;
    $("br + i").each((_index, element) => {
      if (pageDate) return;
      const m = EXTR_PAGE_DATE.exec($(element).text());
      if (m) {
        const parsed = this.parsePageDate(m[1]);
        if (parsed !== null) pageDate = parsed;
      }
    });

    const entries: { chapterId: string; name: string; date: number }[] = [];
    let i = 0;

    $("div.text > table.text > tbody > tr").each((_index, element) => {
      const row = $(element);
      const cells = row.find("td");

      // Date-annotated archive / main archive: anchor in the 3rd cell.
      let anchor = cells.eq(2).find("a").first();
      if (anchor.length > 0) {
        const href = anchor.attr("href") || "";
        if (!href) return;
        const dateText = cells.eq(0).text();
        const date = this.parseDate(dateText) ?? 0;
        entries.push({
          chapterId: this.parsePath(href),
          name: anchor.text().trim(),
          date,
        });
        i++;
        return;
      }

      // Dateless archive: skip section/colspan rows, anchor in the 1st cell.
      const hasColspan = cells.toArray().some((c) => $(c).attr("colspan"));
      if (hasColspan) return;
      anchor = cells.eq(0).find("a").first();
      if (anchor.length > 0) {
        const href = anchor.attr("href") || "";
        if (!href) return;
        entries.push({
          chapterId: this.parsePath(href),
          name: anchor.text().trim(),
          date: pageDate,
        });
        i++;
      }
    });

    entries.reverse();

    const total = entries.length;
    return entries.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: total - 1 - index,
      publishDate: entry.date ? new Date(entry.date) : new Date(0),
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    // Careful. For almost all images it's `div.center>p>img`, except for pages
    // released on April's Fools day, when it's `div.center>p>a>img`.
    const pages: string[] = [];
    $("div.center img").each((_index, element) => {
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
  // Book feed parsing
  // ----------------------------------------------------------------

  // The main archive page `/archive.html` is a combined feed: all finished
  // books appear as book-archive links, and the currently releasing book
  // appears as its own page feed at the end. Each finished book gets its own
  // archive page (e.g. `/archive4.html`); the ongoing book uses `/archive.html`.
  private async fetchBooks(): Promise<BookEntry[]> {
    const $ = await this.fetchCheerio({
      url: `${BASE_URL}/archive.html`,
      method: "GET",
    });

    const books: BookEntry[] = [];
    let nextTitle = NAME;
    let nthManga = 0;
    let reachedOngoing = false;

    const rows = $("div.text > table.text > tbody > tr").toArray();
    for (const element of rows) {
      const row = $(element);
      const th = row.find("th").first();
      if (th.length > 0 && th.text().trim()) {
        nextTitle = `${NAME} ${th.text().trim()}`;
        continue;
      }

      const archiveAnchor = row.find('td[colspan="3"] > a').first();
      const href = archiveAnchor.attr("href") || "";
      if (archiveAnchor.length > 0 && href) {
        books.push({
          mangaId: this.parsePath(href),
          title: nextTitle,
          status: "Completed",
          nthManga: nthManga++,
        });
      } else {
        // We reached the end: the currently releasing book lives in the main
        // archive itself.
        books.push({
          mangaId: this.parsePath("/archive.html"),
          title: nextTitle,
          status: "Ongoing",
          nthManga,
        });
        reachedOngoing = true;
        break;
      }
    }

    if (!reachedOngoing && books.length === 0) {
      books.push({
        mangaId: this.parsePath("/archive.html"),
        title: NAME,
        status: "Ongoing",
        nthManga: 0,
      });
    }

    return books;
  }

  // ----------------------------------------------------------------
  // Date parsing
  // ----------------------------------------------------------------

  private parseDate(text: string): number | null {
    const m = DATE_FMT.exec((text || "").trim());
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const year = parseInt(m[3], 10);
    if (month === undefined || isNaN(day) || isNaN(year)) return null;
    return Date.UTC(year, month, day);
  }

  private parsePageDate(text: string): number | null {
    const m = PAGE_DATE_FMT.exec((text || "").trim());
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const year = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = parseInt(m[6], 10);
    if (month === undefined || isNaN(day) || isNaN(year)) return null;
    return Date.UTC(year, month, day, hh, mm, ss);
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

  private parsePath(href: string): string {
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
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

export const DarthsDroids = new DarthsDroidsExtension();
