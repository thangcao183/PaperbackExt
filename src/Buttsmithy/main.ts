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

const BASE_URL = "https://incase.buttsmithy.com";
const BASE_URL_ALFIE = "https://buttsmithy.com";
const CHAPTER_OVERVIEW_BASE_URL = `${BASE_URL_ALFIE}/archives/chapter`;

const AUTHOR = "InCase";
const ALFIE_TITLE = "Alfie";

// Selectors for the main page menus on incase.buttsmithy.com
const CYOA_SELECTOR = "#menu-item-331";
const OTHER_COMICS_SELECTOR = "#menu-item-38";
const COMIC_LINK_SELECTOR = ".menu-item-type-custom a[href]";

const MAX_PAGES = 1000;

// Alfie's chapter "MISC" pages aren't numbered "pNN"; everything else is.
const PAGE_NR_REGEX = /^p*[0-9]+$/;

// Upstream renders text-based thumbnails via a TextInterceptor. Paperback can't
// reproduce that, so a placeholder image rendered with the title text is used.
function generateImageUrlWithText(text: string): string {
  const safe = encodeURIComponent(text.trim() || "Buttsmithy");
  return `https://placehold.co/300x450/1a1a1a/ffffff/png?text=${safe}`;
}

class ButtsmithyInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
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

type ButtsmithyImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

interface ComicEntry {
  mangaId: string;
  title: string;
  status: string;
  thumbnailUrl: string;
}

export class ButtsmithyExtension implements ButtsmithyImplementation {
  requestManager = new ButtsmithyInterceptor("main");
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
        id: "all",
        title: "All Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const comics = await this.fetchAllComics();
    const items: DiscoverSectionItem[] = comics.map((comic) => ({
      type: "simpleCarouselItem",
      mangaId: comic.mangaId,
      imageUrl: comic.thumbnailUrl,
      title: comic.title,
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
    const comics = await this.fetchAllComics();

    const items: SearchResultItem[] = comics
      .filter(
        (comic) =>
          titleQuery === "" || comic.title.toLowerCase().includes(titleQuery),
      )
      .map((comic) => ({
        mangaId: comic.mangaId,
        imageUrl: comic.thumbnailUrl,
        title: comic.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const isAlfie = url.startsWith(CHAPTER_OVERVIEW_BASE_URL);

    let title = "";
    let status = "Completed";
    let genres: string[] = ["NSFW"];

    if (isAlfie) {
      genres = ["fantasy", "NSFW"];
      const chapUrlName = url.substring(CHAPTER_OVERVIEW_BASE_URL.length + 1);
      const chapTitle = this.chapterUrlNameToTitle(chapUrlName);
      title = `${ALFIE_TITLE} - ${chapTitle}`;
      try {
        const $ = await this.fetchCheerio({
          url: BASE_URL_ALFIE,
          method: "GET",
        });
        const mostRecent = this.extractMostRecentChapterTitle($);
        status = chapTitle.toLowerCase() === mostRecent ? "Unknown" : "Completed";
      } catch {
        status = "Unknown";
      }
    } else {
      // For non-Alfie comics, the manga URL is the first comic page itself.
      const $ = await this.fetchCheerio({ url, method: "GET" });
      title =
        $("#comic img").first().attr("alt")?.trim() || this.safeDecode(mangaId);
    }

    const tagGroups =
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
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: generateImageUrlWithText(
          isAlfie ? ALFIE_TITLE : title,
        ),
        author: AUTHOR,
        artist: AUTHOR,
        synopsis: "",
        contentRating: ContentRating.MATURE,
        status,
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const isAlfie = url.startsWith(CHAPTER_OVERVIEW_BASE_URL);

    const chapters = isAlfie
      ? await this.fetchAlfiePagesAsChapters(sourceManga, url)
      : await this.fetchOtherPagesAsChapters(sourceManga, url);

    return chapters.reverse();
  }

  private async fetchAlfiePagesAsChapters(
    sourceManga: SourceManga,
    startUrl: string,
  ): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    let currentPageUrl = startUrl;
    let lastPageNr = 0;

    for (let guard = 0; guard < MAX_PAGES; guard++) {
      const $ = await this.fetchCheerio({ url: currentPageUrl, method: "GET" });

      const posts = $("article.has-post-thumbnail .post-content").toArray();
      posts.forEach((postEl, index) => {
        const post = $(postEl);
        const link = post.find(".post-info .post-title a").first();
        const chapUrl = link.attr("href") || "";
        const title = link.text().trim();
        if (!chapUrl) return;

        const chapterId = this.parseFullUrl(chapUrl);
        if (seen.has(chapterId)) return;
        seen.add(chapterId);

        let pageNr: number;
        if (PAGE_NR_REGEX.test(title)) {
          const num = parseFloat(title.replace(/^p+/, "").trim());
          pageNr = Number.isNaN(num) ? index + lastPageNr : num;
        } else {
          pageNr = index + lastPageNr;
        }

        const dateString = post.find(".post-info .post-date").text().trim();
        const timeString = post.find(".post-info .post-time").text().trim();
        const publishDate = this.parseAlfieDate(timeString, dateString);

        chapters.push({
          chapterId,
          sourceManga,
          title: title || undefined,
          volume: 0,
          chapNum: pageNr,
          publishDate,
          langCode: "🇬🇧",
        });
      });

      const nextUrl = $(".paginav-next a").first().attr("href") || "";
      if (!nextUrl) break;
      currentPageUrl = nextUrl.startsWith("http")
        ? nextUrl
        : this.absoluteUrl(nextUrl, BASE_URL_ALFIE);
    }

    return chapters;
  }

  private async fetchOtherPagesAsChapters(
    sourceManga: SourceManga,
    startUrl: string,
  ): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    let currentPageUrl = startUrl;
    let pageNr = 0;

    for (let guard = 0; guard < MAX_PAGES; guard++) {
      const $ = await this.fetchCheerio({ url: currentPageUrl, method: "GET" });

      const img = $("#comic img").first();
      const chapterTitle = img.attr("alt")?.trim() || `Page ${pageNr + 1}`;
      const chapterId = this.parseFullUrl(currentPageUrl);

      if (!seen.has(chapterId)) {
        seen.add(chapterId);
        chapters.push({
          chapterId,
          sourceManga,
          title: chapterTitle,
          volume: 0,
          chapNum: pageNr,
          publishDate: new Date(0),
          langCode: "🇬🇧",
        });
      }

      const nextPageUrl = $(".comic-nav-next").first().attr("href") || "";
      if (!nextPageUrl) break;
      currentPageUrl = nextPageUrl.startsWith("http")
        ? nextPageUrl
        : this.absoluteUrl(nextPageUrl, BASE_URL);
      pageNr += 1;
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    const src = $("#comic img").first().attr("src") || "";
    if (src) {
      pages.push(this.absoluteUrl(src, this.originOf(url)));
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
  // Comic listing
  // ----------------------------------------------------------------

  private async fetchAllComics(): Promise<ComicEntry[]> {
    const alfie = await this.fetchAlfieMangas();
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
    const cyoa = this.convertMenuElementToComics($, CYOA_SELECTOR);
    const other = this.convertMenuElementToComics($, OTHER_COMICS_SELECTOR);
    return [...alfie, ...cyoa, ...other];
  }

  private async fetchAlfieMangas(): Promise<ComicEntry[]> {
    const $ = await this.fetchCheerio({ url: BASE_URL_ALFIE, method: "GET" });
    const mostRecent = this.extractMostRecentChapterTitle($);

    const comics: ComicEntry[] = [];
    $("#chapter option.level-0").each((_, el) => {
      const chapTitle = $(el).text().trim().toLowerCase();
      if (!chapTitle) return;
      const chapUrlName = this.chapterTitleToChapterUrlName(chapTitle);
      const url = `${CHAPTER_OVERVIEW_BASE_URL}/${chapUrlName}`;
      comics.push({
        mangaId: this.parseFullUrl(url),
        title: `${ALFIE_TITLE} - ${chapTitle}`,
        status: chapTitle === mostRecent ? "Unknown" : "Completed",
        thumbnailUrl: generateImageUrlWithText(ALFIE_TITLE),
      });
    });

    return comics;
  }

  private convertMenuElementToComics(
    $: CheerioAPI,
    menuSelector: string,
  ): ComicEntry[] {
    const comics: ComicEntry[] = [];
    $(`${menuSelector} ${COMIC_LINK_SELECTOR}`).each((_, el) => {
      const link = $(el);
      const comicTitle = link.text().trim();
      const comicUrl = link.attr("href") || "";
      if (!comicTitle || !comicUrl) return;
      // Skip the legacy Alfie chapter hosted under incase.buttsmithy.com
      if (comicTitle.includes(ALFIE_TITLE)) return;

      comics.push({
        mangaId: this.parseFullUrl(comicUrl),
        title: comicTitle,
        status: "Completed",
        thumbnailUrl: generateImageUrlWithText(comicTitle),
      });
    });
    return comics;
  }

  private extractMostRecentChapterTitle($: CheerioAPI): string {
    return $(".comic-chapter a").first().text().trim().toLowerCase();
  }

  private chapterTitleToChapterUrlName(chapTitle: string): string {
    if (chapTitle.toLowerCase() === "chapter 1") return "chapter-1v2";
    return chapTitle.replace(/ /g, "-").replace(/\./g, "-");
  }

  private chapterUrlNameToTitle(chapUrlName: string): string {
    if (chapUrlName === "chapter-1v2") return "chapter 1";
    return chapUrlName.replace(/-/g, " ");
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

  // Store full absolute URLs as ids because comics span two domains.
  private parseFullUrl(href: string): string {
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
    return this.toSafeId(cleaned);
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

  private originOf(url: string): string {
    const m = url.match(/^(https?:\/\/[^/]+)/);
    return m ? m[1] : BASE_URL;
  }

  private absoluteUrl(src: string, origin: string = BASE_URL): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${origin}${s}` : `${origin}/${s}`;
  }

  private parseAlfieDate(timeString: string, dateString: string): Date {
    // Upstream format: "HH:mm MMMM dd, yyyy" (e.g. "14:30 January 05, 2020")
    const combined = `${timeString} ${dateString}`.trim();
    if (!combined) return new Date(0);
    const parsed = Date.parse(combined);
    if (!Number.isNaN(parsed)) return new Date(parsed);
    // Fall back to parsing just the date portion.
    const dateOnly = Date.parse(dateString);
    return Number.isNaN(dateOnly) ? new Date(0) : new Date(dateOnly);
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

export const Buttsmithy = new ButtsmithyExtension();
