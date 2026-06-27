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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { ManhwalikeSearchForm, ManhwalikeSearchMeta } from "./forms";

const BASE_URL = "https://manhwalike.com";

interface ManhwalikeMetadata {
  page?: number;
}

class ManhwalikeInterceptor extends PaperbackInterceptor {
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

type ManhwalikeImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ManhwalikeExtension implements ManhwalikeImplementation {
  requestManager = new ManhwalikeInterceptor("main");
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
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: ManhwalikeSearchMeta }
      | undefined;
    return new ManhwalikeSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
    const selector =
      section.id === "latest"
        ? "ul.slick_item div.visual"
        : "ul.list-hot div.visual";
    const itemType =
      section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem";

    const items: DiscoverSectionItem[] = [];
    $(selector).each((_, element) => {
      const el = $(element);
      const title = el.find("h3.title a").first().text().trim();
      const href = el.find("a").first().attr("href") || "";
      if (!href || !title) return;
      const imageUrl = this.imageFromElement($, el.find("img").first());
      items.push({
        type: itemType,
        mangaId: this.parsePath(href),
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
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ManhwalikeMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: ManhwalikeSearchMeta } | undefined
    )?.searchMeta;

    // Text search -> POST /search/html/1 with form keyword=, single page.
    if (titleQuery) {
      const $ = await this.fetchCheerioPost(
        `${BASE_URL}/search/html/1`,
        `keyword=${encodeURIComponent(titleQuery)}`,
      );
      const items = this.parseSearchItems($);
      return { items, metadata: undefined };
    }

    // Genre browse.
    const genre = searchMeta?.genre?.[0];
    const path = genre ? `/${genre}` : "";
    const url = `${BASE_URL}${path}?page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items = this.parseSearchItems($);
    const hasNextPage =
      $("ul.pagination li:last-child a").length > 0;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  private parseSearchItems($: CheerioAPI): SearchResultItem[] {
    const items: SearchResultItem[] = [];
    const scope =
      $("ul.normal li").length > 0 ? $("ul.normal li") : $("ul li");
    scope.each((_, element) => {
      const el = $(element);
      const img = el.find("img").first();
      const title = img.attr("alt")?.trim() || "";
      const href = el.find("a").first().attr("href") || "";
      if (!href || !title) return;
      const imageUrl = this.imageFromElement($, img);
      items.push({
        mangaId: this.parsePath(href),
        imageUrl,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });
    return items;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("div.summary-block h1, h1.title, h1").first().text().trim() ||
      this.safeDecode(mangaId);
    const author = $("div.author a").first().text().trim();
    const statusText = $("small:contains(Status) + strong").first().text().trim();
    const synopsis = $("div.summary-block p.about").first().text().trim();
    const thumbnailUrl = this.absoluteUrl(
      $("div.fixed-img img").first().attr("src") || "",
    );

    const genres = $("div.categories a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
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
        thumbnailUrl,
        author: author || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
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
    $("ul.chapter-list li").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const name = link.text().trim();
      const dateText = el.find(".time").first().text().trim();

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $(".chapter-content .page-chapter img").each((_, element) => {
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

  private imageFromElement(
    $: CheerioAPI,
    img: ReturnType<CheerioAPI>,
  ): string {
    const raw = img.attr("data-original") || img.attr("src") || "";
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
    if (s.includes("finish")) return "Completed";
    return "Unknown";
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    const d = new Date(dateText.trim());
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

  async fetchCheerioPost(url: string, body: string): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "x-requested-with": "XMLHttpRequest",
      },
      body,
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(htmlStr);
    return cheerio.load(dom);
  }
}

export const Manhwalike = new ManhwalikeExtension();
