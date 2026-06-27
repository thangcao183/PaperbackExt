import {
  AdvancedSearchForm,
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
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { DflowScansSearchForm, DflowScansSearchMeta } from "./forms";

const BASE_URL = "https://dflow.alwaysdata.net";

interface DflowScansPage {
  url: string;
  num: number;
}

class DflowScansInterceptor extends PaperbackInterceptor {
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

type DflowScansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class DflowScansExtension implements DflowScansImplementation {
  requestManager = new DflowScansInterceptor("main");
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
  // Discover sections (supportsLatest = false -> single section)
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "series",
        title: "Series",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: DflowScansSearchMeta }
      | undefined;
    return new DflowScansSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/Series`, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    this.eachListItem($, (mangaId, title, imageUrl) => {
      items.push({
        type: "featuredCarouselItem",
        mangaId,
        imageUrl,
        title,
        metadata: undefined,
      });
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
    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: DflowScansSearchMeta } | undefined
    )?.searchMeta;
    const status = searchMeta?.status?.[0] ?? "";

    const params: string[] = [];
    params.push(`search=${encodeURIComponent(titleQuery)}`);
    params.push(`status=${encodeURIComponent(status)}`);
    const url = `${BASE_URL}/Series?${params.join("&")}`;

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    this.eachListItem($, (mangaId, title, imageUrl) => {
      results.push({
        mangaId,
        imageUrl,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    return { items: results, metadata: undefined };
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, imageUrl: string) => void,
  ): void {
    $(".col-lg-3.col-md-4.col-sm-6").each((_, element) => {
      const el = $(element);
      const title = el.find(".manga-card-title").first().text().trim();
      const link = el.find(".manga-card-body a.btn").first();
      const href = link.attr("href") || "";
      if (!href || !title) return;
      const imageUrl = this.imageFromElement(
        el.find(".manga-card-image img").first(),
      );
      cb(this.parsePath(href), title, imageUrl);
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
    const thumbnailUrl = this.imageFromElement(
      $(".col-md-4.col-lg-3 img").first(),
    );
    const synopsis = $(".col-md-8.col-lg-9 > p").first().text().trim();

    const genres = $("div:has(> strong:containsOwn(Genres)) span")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const author = $("div:has(> span:containsOwn(Author)) span + span")
      .first()
      .text()
      .trim();
    const artist = $("div:has(> span:containsOwn(Artist)) span + span")
      .first()
      .text()
      .trim();
    const statusText = $("div:has(> span:containsOwn(Status)) span + span")
      .first()
      .text()
      .trim();

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

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author: author || undefined,
        artist: artist || undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(statusText),
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
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    $("div#chapters-section div:has(> a.btn-primary)").each((_, element) => {
      const el = $(element);
      const link = el.find("a.btn-primary").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterTitle = el.find("h5").first().text().trim();
      let subTitle = el
        .find("p:not(:has(i.fa-calendar))")
        .first()
        .text()
        .trim();
      if (subTitle) {
        subTitle = subTitle
          .replace(new RegExp(` - ${this.escapeRegex(chapterTitle)}$`), "")
          .replace(new RegExp(` ${this.escapeRegex(chapterTitle)}$`), "");
      }
      const name = subTitle ? `${chapterTitle} - ${subTitle}` : chapterTitle;
      const dateText = el.find("p:has(i.fa-calendar)").first().text().trim();
      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(chapterTitle),
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const html = await this.fetchString({ url, method: "GET" });

    const marker = "const pages = ";
    const start = html.indexOf(marker);
    let pages: string[] = [];
    if (start !== -1) {
      const after = html.substring(start + marker.length);
      const end = after.indexOf(";");
      const json = end !== -1 ? after.substring(0, end) : after;
      try {
        const parsed = JSON.parse(json) as DflowScansPage[];
        const sorted = parsed
          .slice()
          .sort((a, b) => a.num - b.num);
        pages = sorted.map((p) => this.absoluteUrl(p.url));
      } catch {
        pages = [];
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

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const raw =
      img.attr("data-lazy-src") || img.attr("data-src") || img.attr("src") || "";
    return this.absoluteUrl(raw);
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

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private parseChapterNumber(name: string): number {
    const match = name.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : -1;
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("dropped")) return "Cancelled";
    return "Unknown";
  }

  private parseDate(text: string): Date {
    const t = (text || "").trim();
    if (!t) return new Date(0);
    const d = new Date(t);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

  async fetchString(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
  }
}

export const DflowScans = new DflowScansExtension();
