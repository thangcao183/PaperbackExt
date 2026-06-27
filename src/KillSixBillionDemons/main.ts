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

const BASE_URL = "https://killsixbilliondemons.com";
const AUTHOR = "Abbadon";
const PAGES_ORDER = "?order=ASC";

const DESCRIPTION = `Q: What is this all about?
This is a webcomic! It's graphic novel style, meaning it's meant to be read in large chunks, but you can subject yourself to the agony of reading it a couple pages a week!

Q: Do you have a twitter/tumble machine? Just who the hell draws this thing anyway?
A mysterious comics goblin named Abbadon draws this mess. My twitter is @orbitaldropkick, my tumblr is orbitaldropkick.tumblr.com. If you're feeling dangerous, you can e-mail me at ksbdabbadon@gmail.com

Q: A webcomic, eh? When does it update?
Tuesday and Friday evenings (and occasionally weekends). Sometimes it will be up quite late on those days.

Q: Who's this YISUN guy that keeps getting talked about?
Someone has not read their Psalms and Spasms recently!

Q: Can I buy this book in a more traditional format?
You absolutely can. You can get your hands on a print copy of the first and second books from Image comics in your local comics shop or anywhere else you can get comics.`;

// Strips WordPress generated thumbnail dimensions, e.g. "-300x200" before the extension.
const WORDPRESS_THUMBNAIL_REGEX =
  /-\d+x\d+(?=\.(?:jpe?g|png|webp|gif)(?:\?.*)?$)/i;

class KillSixBillionDemonsInterceptor extends PaperbackInterceptor {
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

type KillSixBillionDemonsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

interface BookEntry {
  mangaId: string;
  title: string;
}

export class KillSixBillionDemonsExtension
  implements KillSixBillionDemonsImplementation
{
  requestManager = new KillSixBillionDemonsInterceptor("main");
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
    const items: DiscoverSectionItem[] = [];
    for (const book of books) {
      const imageUrl = await this.fetchThumbnailUrl(book.mangaId);
      items.push({
        type: "simpleCarouselItem",
        mangaId: book.mangaId,
        imageUrl,
        title: book.title,
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
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const books = await this.fetchBooks();
    const results: SearchResultItem[] = [];
    for (const book of books) {
      if (titleQuery !== "" && !book.title.toLowerCase().includes(titleQuery)) {
        continue;
      }
      const imageUrl = await this.fetchThumbnailUrl(book.mangaId);
      results.push({
        mangaId: book.mangaId,
        imageUrl,
        title: book.title,
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
    const books = await this.fetchBooks();
    const book = books.find((b) => b.mangaId === mangaId);
    const title = book ? book.title : this.safeDecode(mangaId);
    const thumbnailUrl = await this.fetchThumbnailUrl(mangaId);
    const status = await this.fetchStatusForBook(title);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author: AUTHOR,
        artist: AUTHOR,
        synopsis: DESCRIPTION,
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

    const mangaPath = this.urlPath(this.mangaUrl(sourceManga.mangaId)).replace(
      /\/+$/,
      "",
    );

    const chapters: Chapter[] = [];
    let foundBook = false;
    let chapterIndex = 1;

    const options = $("#chapter option").toArray();
    for (const option of options) {
      const el = $(option);
      if (!this.isValidOption(el)) continue;

      const text = el.text().trim();
      const value = el.attr("value") || "";

      if (this.isBookOption(el)) {
        if (foundBook) {
          // Reached the next book, stop gathering chapters.
          break;
        }
        const optionPath = this.urlPath(value).replace(/\/+$/, "");
        if (optionPath.toLowerCase() === mangaPath.toLowerCase()) {
          foundBook = true;
        }
      } else if (foundBook) {
        const chapterId = this.parsePath(value);
        if (!chapterId) continue;
        const chapterTitle = `Chapter ${text.split(" (")[0].trim()}`;
        chapters.push({
          chapterId,
          sourceManga,
          title: chapterTitle,
          volume: 0,
          chapNum: chapterIndex++,
          publishDate: new Date(0),
          langCode: "🇬🇧",
        });
      }
    }

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages: string[] = [];
    const seen = new Set<string>();
    let url = `${this.chapterUrl(chapter.chapterId)}${PAGES_ORDER}`;

    for (let i = 0; i < 100; i++) {
      const $ = await this.fetchCheerio({ url, method: "GET" });

      const thumbImgs = $(".comic-thumbnail-in-archive a img").toArray();
      if (thumbImgs.length > 0) {
        for (const img of thumbImgs) {
          const src = $(img).attr("src") || "";
          if (!src) continue;
          const imageUrl = this.absoluteUrl(
            src.replace(WORDPRESS_THUMBNAIL_REGEX, ""),
          );
          if (imageUrl) pages.push(imageUrl);
        }
      } else {
        const src = $("#comic img").first().attr("src") || "";
        if (src) {
          const imageUrl = this.absoluteUrl(
            src.replace(WORDPRESS_THUMBNAIL_REGEX, ""),
          );
          if (imageUrl) pages.push(imageUrl);
        }
      }

      const nextUrl = $(".paginav-next a").first().attr("href") || "";
      if (!nextUrl) break;
      const absoluteNext = this.absoluteUrl(nextUrl);
      if (seen.has(absoluteNext)) break;
      seen.add(absoluteNext);
      url = absoluteNext;
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
  // Book helpers (mirror the Kotlin fetchBooksAsMangas logic)
  // ----------------------------------------------------------------

  private async fetchBooks(): Promise<BookEntry[]> {
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
    const books: BookEntry[] = [];
    const seen = new Set<string>();

    $("#chapter option").each((_, option) => {
      const el = $(option);
      if (!this.isBookOption(el)) return;
      const value = el.attr("value") || "";
      if (!value) return;
      const mangaId = this.parsePath(value);
      if (!mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      const title = el.text().trim().split(" (")[0].trim();
      books.push({ mangaId, title });
    });

    return books;
  }

  private async fetchThumbnailUrl(mangaId: string): Promise<string> {
    const url = `${this.mangaUrl(mangaId)}${PAGES_ORDER}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const src =
      $(".comic-thumbnail-in-archive a img").first().attr("src") || "";
    return this.absoluteUrl(src);
  }

  private async fetchStatusForBook(bookTitle: string): Promise<string> {
    const bookTitleWithoutBook = bookTitle.includes(": ")
      ? bookTitle.split(": ").slice(1).join(": ")
      : bookTitle;
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
    const postTitle = $(".post-title").first().text() || "";
    return postTitle
      .toLowerCase()
      .includes(bookTitleWithoutBook.toLowerCase())
      ? "Unknown"
      : "Completed";
  }

  private isValidOption(el: Cheerio<AnyNode>): boolean {
    const text = el.text().trim();
    return el.attr("value") !== "0" && text.toLowerCase() !== "select chapter";
  }

  private isBookOption(el: Cheerio<AnyNode>): boolean {
    if (!this.isValidOption(el)) return false;
    const label = el.text().trim().split(" (")[0].trim();
    // Book options have non-numeric labels; chapter options are numeric.
    return label === "" || Number.isNaN(Number(label));
  }

  // ----------------------------------------------------------------
  // URL / id helpers
  // ----------------------------------------------------------------

  private urlPath(url: string): string {
    const decoded = this.safeDecode(url);
    if (decoded.startsWith("http")) {
      const match = decoded.match(/^https?:\/\/[^/]+(\/[^?#]*)/);
      return match ? match[1] : "/";
    }
    return decoded.replace(/[?#].*$/, "");
  }

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
    const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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

export const KillSixBillionDemons = new KillSixBillionDemonsExtension();
