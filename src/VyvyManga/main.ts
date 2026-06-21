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
import { VyvyMangaSearchForm, VyvyMangaSearchMeta } from "./forms";

const BASE_URL = "https://vymanga.net";

interface VyvyMangaMetadata {
  page?: number;
}

class VyvyMangaInterceptor extends PaperbackInterceptor {
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

type VyvyMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class VyvyMangaExtension implements VyvyMangaImplementation {
  requestManager = new VyvyMangaInterceptor("main");
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
      | { searchMeta?: VyvyMangaSearchMeta }
      | undefined;
    return new VyvyMangaSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as VyvyMangaMetadata | undefined;
    const page = meta?.page ?? 1;

    let url: string;
    if (section.id === "latest") {
      url = `${BASE_URL}/search?sort=updated_at${
        page !== 1 ? `&page=${page}` : ""
      }`;
    } else {
      url = `${BASE_URL}/search${page !== 1 ? `?page=${page}` : ""}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    this.eachListItem($, (parsed) => {
      items.push({
        type:
          section.id === "latest"
            ? "simpleCarouselItem"
            : "featuredCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = $("[rel=next]").length > 0;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as VyvyMangaMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: VyvyMangaSearchMeta } | undefined
    )?.searchMeta;

    const url = this.buildSearchUrl(titleQuery, searchMeta, page);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    this.eachListItem($, (parsed) => {
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $("[rel=next]").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    titleQuery: string,
    searchMeta: VyvyMangaSearchMeta | undefined,
    page: number,
  ): string {
    const params: string[] = [];
    if (titleQuery) {
      params.push(`q=${encodeURIComponent(titleQuery)}`);
    }
    params.push(`page=${page}`);

    const searchType = searchMeta?.searchType?.[0];
    if (searchType) params.push(`search_po=${encodeURIComponent(searchType)}`);

    if ((searchMeta?.searchDescription?.[0] ?? "") === "1") {
      params.push("check_search_desc=1");
    }

    const author = (searchMeta?.author ?? "").trim();
    if (author) {
      const authorType = searchMeta?.authorSearchType?.[0];
      if (authorType)
        params.push(`author_po=${encodeURIComponent(authorType)}`);
      params.push(`author=${encodeURIComponent(author)}`);
    }

    const status = searchMeta?.status?.[0];
    if (status) params.push(`completed=${encodeURIComponent(status)}`);

    const sort = searchMeta?.sort?.[0];
    if (sort) params.push(`sort=${encodeURIComponent(sort)}`);

    const sortType = searchMeta?.sortType?.[0];
    if (sortType) params.push(`sort_type=${encodeURIComponent(sortType)}`);

    for (const genre of searchMeta?.includeGenres ?? []) {
      params.push(`genre[]=${encodeURIComponent(genre)}`);
    }
    for (const genre of searchMeta?.excludeGenres ?? []) {
      params.push(`exclude_genre[]=${encodeURIComponent(genre)}`);
    }

    return `${BASE_URL}/search?${params.join("&")}`;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
    const thumbnailUrl = this.absoluteUrl(
      $(".img-manga img").first().attr("src") || "",
    );
    const synopsis = $(".summary > .content").first().text().trim();
    const author = $(".pre-title:contains(Author) ~ a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((a) => a.length > 0)
      .join(", ");
    const artist = $(".pre-title:contains(Artist) ~ a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((a) => a.length > 0)
      .join(", ");
    const statusText = $(".pre-title:contains(Status) ~ span:not(.space)")
      .first()
      .text()
      .trim();

    const genres = $(".pre-title:contains(Genres) ~ a")
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
        author: author || undefined,
        artist: artist || undefined,
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
    $(".list-group > a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const name = el.find("span").first().text().trim();
      const dateText = el.find("> p").first().text().trim();

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseChapterDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("img.d-block").each((_, element) => {
      const src = $(element).attr("data-src") || "";
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

  private eachListItem(
    $: CheerioAPI,
    cb: (parsed: {
      mangaId: string;
      title: string;
      imageUrl: string;
    }) => void,
  ): void {
    $(".comic-item").each((_, element) => {
      const el = $(element);
      const parsed = this.parseListItem($, el);
      if (parsed) cb(parsed);
    });
  }

  private parseListItem(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; title: string; imageUrl: string } | undefined {
    const link = el.find("a").first();
    const href = link.attr("href") || "";
    const title = el.find(".comic-title").first().text().trim();
    if (!href || !title) return undefined;
    const imageUrl = this.absoluteUrl(
      el.find(".comic-image img.image.lozad").first().attr("data-src") || "",
    );
    return { mangaId: this.parsePath(href), title, imageUrl };
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
    // VyvyManga uses absolute http URLs for both manga and chapters; keep them.
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
    return "Unknown";
  }

  private parseChapterDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    const text = dateText.trim();
    if (/ago$/i.test(text)) {
      const m = text.match(/(\d+)/);
      const n = m ? parseInt(m[1], 10) : 0;
      const now = Date.now();
      if (/day/i.test(text)) return new Date(now - n * 86400000);
      if (/hour/i.test(text)) return new Date(now - n * 3600000);
      if (/minute/i.test(text)) return new Date(now - n * 60000);
      if (/second/i.test(text)) return new Date(now - n * 1000);
      if (/week/i.test(text)) return new Date(now - n * 7 * 86400000);
      if (/month/i.test(text)) return new Date(now - n * 30 * 86400000);
      if (/year/i.test(text)) return new Date(now - n * 365 * 86400000);
      return new Date(now);
    }
    const fallback = new Date(text);
    return isNaN(fallback.getTime()) ? new Date(0) : fallback;
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

export const VyvyManga = new VyvyMangaExtension();
