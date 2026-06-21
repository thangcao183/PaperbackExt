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
import { MangaBttSearchForm, MangaBttSearchMeta } from "./forms";

const BASE_URL = "https://manhwabtt.cc";

interface MangaBttMetadata {
  page?: number;
}

class MangaBttInterceptor extends PaperbackInterceptor {
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

type MangaBttImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaBttExtension implements MangaBttImplementation {
  requestManager = new MangaBttInterceptor("main");
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
      | { searchMeta?: MangaBttSearchMeta }
      | undefined;
    return new MangaBttSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaBttMetadata | undefined;
    const page = meta?.page ?? 1;

    // Popular: sort "Top month" (11); Latest: sort "Latest Updates" (0).
    const sort = section.id === "popular" ? "11" : "0";
    const url = this.buildBrowseUrl("", sort, "-1", "", page);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const itemType =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    this.eachListItem($, (mangaId, title, imageUrl) => {
      items.push({ type: itemType, mangaId, imageUrl, title, metadata: undefined });
    });

    const hasNextPage =
      $("ul.pagination > li.active + li:not(.disabled)").length > 0;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaBttMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangaBttSearchMeta } | undefined
    )?.searchMeta;

    let url: string;
    if (titleQuery) {
      url = `${BASE_URL}/find-story?keyword=${encodeURIComponent(
        titleQuery,
      )}&page=${page}`;
    } else {
      const sort = searchMeta?.sort?.[0] ?? "11";
      const status = searchMeta?.status?.[0] ?? "-1";
      const genre = searchMeta?.genre?.[0] ?? "";
      url = this.buildBrowseUrl("", sort, status, genre, page);
    }

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

    const hasNextPage =
      $("ul.pagination > li.active + li:not(.disabled)").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildBrowseUrl(
    keyword: string,
    sort: string,
    status: string,
    genre: string,
    page: number,
  ): string {
    let path = "/find-story";
    if (genre) {
      path += `/${encodeURIComponent(genre)}`;
    }
    const params: string[] = [];
    if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
    params.push(`status=${encodeURIComponent(status)}`);
    params.push(`sort=${encodeURIComponent(sort)}`);
    params.push(`page=${page}`);
    return `${BASE_URL}${path}?${params.join("&")}`;
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, imageUrl: string) => void,
  ): void {
    $(".items > .row > .item").each((_, element) => {
      const el = $(element);
      const link = el.find("figcaption h3 a").first();
      const href = link.attr("href") || "";
      const title = link.text().trim();
      if (!href || !title) return;
      const imageUrl = this.imageFromElement(el.find(".image img").first());
      cb(this.parsePath(href), title, imageUrl);
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1.title-detail").first().text().trim() || this.safeDecode(mangaId);
    const rawDesc = $(".detail-content p").first().text().trim();
    const synopsis = rawDesc.includes("comic site. The Summary is ")
      ? rawDesc.split("comic site. The Summary is ")[1].trim()
      : rawDesc;

    const info = $(".detail-info").first();
    const thumbnailUrl = this.imageFromElement(info.find("img").first());
    const statusText = info.find(".status p:not(.name)").first().text().trim();
    const authorText = info.find(".author p:not(.name)").first().text().trim();
    const author =
      authorText && authorText.toLowerCase() !== "updating"
        ? authorText
        : undefined;

    const genres = info
      .find(".kind a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

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
        author,
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
    const slug = this.safeDecode(sourceManga.mangaId);
    const storyId = slug.substring(slug.lastIndexOf("-") + 1);
    const body = `StoryID=${encodeURIComponent(storyId)}`;
    const $ = await this.fetchCheerioPost(
      `${BASE_URL}/Story/ListChapterByStoryID`,
      body,
      this.mangaUrl(sourceManga.mangaId),
    );

    const chapters: Chapter[] = [];
    $("ul > li:not(.heading)").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      const name = link.text().trim();
      if (!href || !name) return;
      const dateText = el.find(".col-xs-4").first().text().trim();
      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseRelativeDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const entries: { index: number; url: string }[] = [];
    $(".reading-detail > .page-chapter").each((_, element) => {
      const img = $(element).find("img[data-index]").first();
      if (img.length === 0) return;
      const index = parseInt(img.attr("data-index") || "0", 10);
      const src = this.imageFromElement(img);
      if (src) entries.push({ index, url: src });
    });
    entries.sort((a, b) => a.index - b.index);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: entries.map((e) => e.url),
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
    if (s.includes("ongoing") || s.includes("đang cập nhật")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("on-hold")) return "Hiatus";
    if (s.includes("canceled")) return "Cancelled";
    return "Unknown";
  }

  private parseRelativeDate(text: string): Date {
    const t = (text || "").toLowerCase();
    const numStr = t
      .split(" ")[0]
      ?.replace("one", "1")
      .replace("a", "1");
    const num = parseInt(numStr || "", 10);
    if (isNaN(num)) return new Date(0);
    const now = Date.now();
    let ms = 0;
    if (t.includes("second")) ms = num * 1000;
    else if (t.includes("minute")) ms = num * 60 * 1000;
    else if (t.includes("hour")) ms = num * 60 * 60 * 1000;
    else if (t.includes("day")) ms = num * 24 * 60 * 60 * 1000;
    else if (t.includes("week")) ms = num * 7 * 24 * 60 * 60 * 1000;
    else if (t.includes("month")) ms = num * 30 * 24 * 60 * 60 * 1000;
    else if (t.includes("year")) ms = num * 365 * 24 * 60 * 60 * 1000;
    else return new Date(0);
    return new Date(now - ms);
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

  async fetchCheerioPost(
    url: string,
    body: string,
    referer: string,
  ): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer,
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

export const MangaBtt = new MangaBttExtension();
