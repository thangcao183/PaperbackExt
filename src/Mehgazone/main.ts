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

const BASE_URL = "https://mehgazone.com";
const AUTHOR = "Patricia Barton";

const THUMBNAIL_REGEX = /\/[^/]+-([0-9]+\.png)$/i;

class MehgazoneInterceptor extends PaperbackInterceptor {
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

type MehgazoneImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

interface ChapterListEntry {
  id: number;
  title: string;
  date: string;
  excerpt: string;
}

interface PageListEntry {
  link: string;
  content: string;
  excerpt: string;
}

export class MehgazoneExtension implements MehgazoneImplementation {
  requestManager = new MehgazoneInterceptor("main");
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
        title: "Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const series = await this.fetchSeriesList();
    const items: DiscoverSectionItem[] = series.map((entry) => ({
      type: "simpleCarouselItem",
      mangaId: entry.mangaId,
      imageUrl: entry.imageUrl,
      title: entry.title,
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
    const series = await this.fetchSeriesList();
    const items: SearchResultItem[] = series
      .filter(
        (entry) =>
          titleQuery === "" || entry.title.toLowerCase().includes(titleQuery),
      )
      .map((entry) => ({
        mangaId: entry.mangaId,
        imageUrl: entry.imageUrl,
        title: entry.title,
        subtitle: undefined,
        metadata: undefined,
      }));
    return { items, metadata: undefined };
  }

  // Parse the homepage sidebar for the "Latest" series listings.
  private async fetchSeriesList(): Promise<
    { mangaId: string; imageUrl: string; title: string }[]
  > {
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });

    const results: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();

    const sidebar = $(
      "#main aside.primary-sidebar .sidebar-group",
    ).first();
    sidebar.find("h2").each((_, element) => {
      const heading = $(element);
      const headingText = heading.text();
      if (!/latest/i.test(headingText)) return;

      const parts = headingText.split('"');
      if (parts.length < 2) return;
      const title = this.unescapeText(parts[1]);
      if (!title) return;

      // Search the following siblings for the feed link and image.
      const siblings = heading.nextAll();
      const feedLink = siblings.find("a[href*='/feed']").first();
      const href = feedLink.attr("href") || "";
      if (!href) return;
      const mangaUrl = this.resolveToRoot(href);
      if (!mangaUrl) return;
      const mangaId = this.toSafeId(mangaUrl);
      if (seen.has(mangaId)) return;
      seen.add(mangaId);

      const img = siblings.find("img").first();
      const imageUrl = this.imageFromElement(img);

      results.push({ mangaId, imageUrl, title });
    });

    return results;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      this.unescapeText($("head > title").first().text().trim()) ||
      this.safeDecode(mangaId);

    let thumbnailUrl = "";
    $("#content img[src*='.png']").each((_, element) => {
      if (thumbnailUrl) return;
      const src = $(element).attr("src") || "";
      if (THUMBNAIL_REGEX.test(src)) {
        thumbnailUrl = this.absoluteUrl(src.replace(THUMBNAIL_REGEX, "/$1"));
      }
    });

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author: AUTHOR,
        artist: AUTHOR,
        synopsis: "",
        contentRating: ContentRating.MATURE,
        status: "Ongoing",
        tagGroups: [],
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaUrl = this.mangaUrl(sourceManga.mangaId).replace(/\/+$/, "");

    const entries: ChapterListEntry[] = [];
    let page = 1;
    let totalPages = -1;
    do {
      const url = `${mangaUrl}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,date_gmt,excerpt`;
      const [response, data] = await Application.scheduleRequest({
        url,
        method: "GET",
      });
      if (response.status >= 400) break;

      const json = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      ) as unknown;
      if (!Array.isArray(json)) break;

      for (const raw of json) {
        const parsed = this.parseChapterListEntry(raw);
        if (parsed) entries.push(parsed);
      }

      const totalHeader = response.headers?.["x-wp-totalpages"];
      if (totalPages === -1) {
        totalPages = totalHeader ? parseInt(totalHeader, 10) : -1;
      }

      if (totalPages > 0) {
        if (page >= totalPages) break;
      } else if (json.length < 100) {
        break;
      }
      page++;
    } while (page < 1000);

    // Filter Patreon-locked, dedupe, sort by date ascending, number, reverse.
    const seen = new Set<number>();
    const filtered = entries
      .filter((e) => !e.excerpt.includes("Unlock with Patreon"))
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort((a, b) => this.parseDate(a.date).getTime() - this.parseDate(b.date).getTime());

    const chapters: Chapter[] = filtered.map((entry, index) => {
      const name =
        this.unescapeText(entry.title).trim() || entry.date.split("T")[0];
      return {
        chapterId: this.toSafeId(`${mangaUrl}/?p=${entry.id}`),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: index,
        publishDate: this.parseDate(entry.date),
        langCode: "🇬🇧",
      };
    });

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.chapterUrl(chapter.chapterId);
    const postId = this.extractPostId(chapterUrl);
    const root = chapterUrl.split("/?")[0].replace(/\/+$/, "");

    const url = `${root}/wp-json/wp/v2/posts?per_page=1&_fields=link,content,excerpt,date,title&include=${postId}`;
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });

    const pages: string[] = [];
    if (response.status < 400) {
      const json = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      ) as unknown;
      const entry =
        Array.isArray(json) && json.length > 0
          ? this.parsePageListEntry(json[0])
          : undefined;
      if (entry) {
        const dom = htmlparser2.parseDocument(entry.content);
        const $ = cheerio.load(dom);
        $("img").each((_, element) => {
          const src = $(element).attr("src") || "";
          if (src) pages.push(this.absoluteUrl(src));
        });
      }
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

  private parseChapterListEntry(raw: unknown): ChapterListEntry | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const obj = raw as Record<string, unknown>;
    const id = typeof obj.id === "number" ? obj.id : undefined;
    if (id === undefined) return undefined;
    const date = typeof obj.date_gmt === "string" ? obj.date_gmt : "";
    const title = this.renderedString(obj.title);
    const excerpt = this.renderedString(obj.excerpt);
    return { id, title, date, excerpt };
  }

  private parsePageListEntry(raw: unknown): PageListEntry | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const obj = raw as Record<string, unknown>;
    const link = typeof obj.link === "string" ? obj.link : "";
    const content = this.renderedString(obj.content);
    const excerpt = this.renderedString(obj.excerpt);
    return { link, content, excerpt };
  }

  private renderedString(value: unknown): string {
    if (typeof value !== "object" || value === null) return "";
    const rendered = (value as Record<string, unknown>).rendered;
    return typeof rendered === "string" ? rendered : "";
  }

  private extractPostId(url: string): string {
    const m = url.match(/[?&]p=(\d+)/);
    return m ? m[1] : "";
  }

  private resolveToRoot(href: string): string {
    const s = (href || "").trim();
    if (!s) return "";
    try {
      const u = new URL(s, BASE_URL);
      return `${u.protocol}//${u.host}/`;
    } catch {
      return "";
    }
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

  private parseDate(date: string): Date {
    if (!date) return new Date(0);
    const normalized = date.endsWith("Z") ? date : `${date}Z`;
    const time = Date.parse(normalized);
    return isNaN(time) ? new Date(0) : new Date(time);
  }

  private unescapeText(text: string): string {
    if (!text) return "";
    const dom = htmlparser2.parseDocument(`<div>${text}</div>`);
    return cheerio.load(dom)("div").first().text();
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    return this.absoluteUrl(src);
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

export const Mehgazone = new MehgazoneExtension();
