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
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://mangayi.com";
const COVER_BASE = "https://scp.keterfoundation.com/cover";

interface MangaDto {
  i: string; // slug
  t: string; // title
}

class MangaYiInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      "user-agent": await Application.getDefaultUserAgent(),
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
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

type MangaYiImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class MangaYiExtension implements MangaYiImplementation {
  requestManager = new MangaYiInterceptor("main");
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
    const list = await this.fetchSearch({ t: 1 });
    return {
      items: list.map((manga) => ({
        type: "featuredCarouselItem",
        mangaId: this.toSafeId(manga.i),
        imageUrl: this.coverUrl(manga.i),
        title: manga.t,
        metadata: undefined,
      })),
      metadata: undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const list = titleQuery
      ? await this.fetchSearch({ s: titleQuery })
      : await this.fetchSearch({ t: 1 });

    return {
      items: list.map((manga) => ({
        mangaId: this.toSafeId(manga.i),
        title: manga.t,
        imageUrl: this.coverUrl(manga.i),
        metadata: undefined,
      })),
      metadata: undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const $ = await this.fetchCheerio({ url: this.mangaUrl(slug), method: "GET" });

    const title = $("h1.title").first().text().trim();
    const author = $(".authors").first().text().trim();
    const descParts: string[] = [];
    $(".summary p").each((_, el) => {
      const t = $(el).text().trim();
      if (t) descParts.push(t);
    });

    const genres: string[] = [];
    $(".genres .pill").each((_, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });

    const tagGroups: TagSection[] =
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

    const statusText = $(".stat:contains(Status) .value").first().text().trim();
    const thumbnail =
      this.absoluteUrl(
        $(".cover-wrapper img.cover-image").first().attr("src") || "",
      ) || this.coverUrl(slug);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title || slug,
        secondaryTitles: [],
        thumbnailUrl: thumbnail,
        author: author || undefined,
        synopsis: descParts.join("\n"),
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: this.mangaUrl(slug),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url: this.mangaUrl(slug), method: "GET" });

    const elements = $("div.chapters a.c:not(.unreleased)").toArray();
    const total = elements.length;
    const result: Chapter[] = [];
    elements.forEach((el, index) => {
      const anchor = $(el);
      const href = anchor.attr("href");
      if (!href) return;
      const name = anchor.find(".t").first().text().trim() || "Chapter";
      const dateText = anchor.find(".chapter-date").first().text().trim();
      result.push({
        chapterId: this.parseChapterId(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: total - index,
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });
    return result;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetchCheerio({
      url: this.chapterUrl(chapter.chapterId),
      method: "GET",
    });

    const pages: string[] = [];
    $("div.images img").each((_, el) => {
      const src = this.absoluteUrl($(el).attr("src") || "");
      if (src) pages.push(src);
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(this.safeDecode(mangaId));
  }

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

  // ---- helpers ----

  private async fetchSearch(payload: {
    s?: string;
    t?: number;
  }): Promise<MangaDto[]> {
    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/api/search`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 404) return [];
    try {
      const parsed = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      ) as MangaDto[];
      return (Array.isArray(parsed) ? parsed : []).filter((m) => m.i && m.t);
    } catch {
      return [];
    }
  }

  private coverUrl(slug: string): string {
    return `${COVER_BASE}/${slug}.jpg`;
  }

  private mangaUrl(slug: string): string {
    const s = slug.startsWith("http") ? slug : slug.replace(/^\/+|\/+$/g, "");
    if (s.startsWith("http")) return s;
    return `${BASE_URL}/read/${s}/`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parseChapterId(href: string): string {
    const cleaned = href.replace(/[#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
  }

  private parseStatus(status?: string | null): string {
    const s = (status ?? "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    if (s === "hiatus" || s === "on hiatus") return "Hiatus";
    if (s === "cancelled") return "Cancelled";
    return "Unknown";
  }

  private parseDate(value?: string | null): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return isNaN(t) ? new Date(0) : new Date(t);
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

export const MangaYi = new MangaYiExtension();
