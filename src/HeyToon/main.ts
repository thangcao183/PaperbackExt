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
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { HeyToonSearchForm, HeyToonSearchMeta } from "./forms";

const BASE_URL = "https://heytoon.net";

interface HeyToonComicDto {
  linkComic: string;
  title: string;
  raw_thumb?: string;
}

class HeyToonInterceptor extends PaperbackInterceptor {
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

type HeyToonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class HeyToonExtension implements HeyToonImplementation {
  requestManager = new HeyToonInterceptor("main");
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

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number })?.page ?? 1;

    if (section.id === "popular" && page === 1) {
      // Homepage popular/trending slider
      const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      $(
        "section[class*=slider]:has(h2:matches((?i)popular|trending)) a",
      ).each((_, element) => {
        const el = $(element);
        const href = el.attr("href") || "";
        const title = el.text().trim();
        if (!href || !title) return;
        const imageUrl = this.absoluteUrl(
          el.find("img[alt!=badge]").first().attr("data-src") || "",
        );
        items.push({
          type: "featuredCarouselItem",
          mangaId: this.parsePath(href),
          imageUrl,
          title,
          metadata: undefined,
        });
      });
      return { items, metadata: { page: 2 } };
    }

    const sort = section.id === "latest" ? "latest" : "views";
    const browsePage = section.id === "popular" ? page - 1 : page;
    const itemType =
      section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem";
    const { entries, hasNextPage } = await this.browse(
      undefined,
      sort,
      browsePage,
    );
    const items: DiscoverSectionItem[] = entries.map((e) => ({
      type: itemType,
      mangaId: e.mangaId,
      imageUrl: e.imageUrl,
      title: e.title,
      metadata: undefined,
    }));
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(): Promise<AdvancedSearchForm> {
    return new HeyToonSearchForm();
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const searchMeta = (query.metadata as { searchMeta?: HeyToonSearchMeta })
      ?.searchMeta;

    if (titleQuery) {
      // Text search via JSON API (single page)
      const url = `${BASE_URL}/api/complete-search?keyword=${encodeURIComponent(
        titleQuery,
      )}`;
      const list = await this.fetchJson<HeyToonComicDto[]>({
        url,
        method: "GET",
        headers: { "x-requested-with": "XMLHttpRequest" },
      });
      const items: SearchResultItem[] = list.map((comic) => ({
        mangaId: this.parsePath(comic.linkComic),
        imageUrl: this.absoluteUrl(comic.raw_thumb || ""),
        title: comic.title,
        subtitle: undefined,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const page = (metadata as { page?: number })?.page ?? 1;
    const sort = searchMeta?.sort?.[0] || "latest";
    const genre = searchMeta?.genre?.[0] || "";
    const result = await this.browse(genre, sort, page);
    const items: SearchResultItem[] = result.entries.map((it) => ({
      mangaId: it.mangaId,
      imageUrl: it.imageUrl,
      title: it.title,
      subtitle: undefined,
      metadata: undefined,
    }));
    return {
      items,
      metadata: result.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async browse(
    genre: string | undefined,
    sort: string,
    page: number,
  ): Promise<{
    entries: { mangaId: string; title: string; imageUrl: string }[];
    hasNextPage: boolean;
  }> {
    let url = `${BASE_URL}/en/genres`;
    if (genre) {
      url += `/${encodeURIComponent(genre)}`;
    }
    const params: string[] = [`orderBy=${encodeURIComponent(sort)}`];
    if (page > 1) {
      params.push(`page=${page}`);
    }
    url += `?${params.join("&")}`;

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const entries: { mangaId: string; title: string; imageUrl: string }[] = [];
    $("div[class*=comicItem] a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const img = el.find("img[alt!=badge]").first();
      const title = img.attr("title") || el.text().trim();
      if (!title) return;
      const imageUrl = this.absoluteUrl(img.attr("data-src") || "");
      entries.push({ mangaId: this.parsePath(href), title, imageUrl });
    });
    const hasNextPage = $(".wp-pagenavi .nextpostslink").length > 0;
    return { entries, hasNextPage };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("#titleSubWrapper h1.titCon").first().text().trim() ||
      this.safeDecode(mangaId);
    const synopsis = $("#modal_detail .cont_area p").first().text().trim();
    const thumbnailUrl = this.absoluteUrl(
      $("meta[property=og:image]").first().attr("content") || "",
    );

    const genres: { id: string; title: string }[] = [];
    $("#modal_detail a[href*=genres]").each((_, element) => {
      const name = $(element).text().trim();
      if (name) {
        genres.push({ id: name.toLowerCase().replace(/\s+/g, "-"), title: name });
      }
    });
    const tagGroups: TagSection[] =
      genres.length > 0
        ? [{ id: "genres", title: "Genres", tags: genres }]
        : [];

    const badges = $(".badgeArea span")
      .map((_, el) => $(el).text().trim())
      .get();
    let status = "Unknown";
    if (badges.includes("Up")) {
      status = "Ongoing";
    } else if (badges.includes("Completed")) {
      status = "Completed";
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis,
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
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const elements = $(".episodeListConPC a#episodeItemCon").toArray();
    elements.forEach((element, index) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const name =
        el.find(".comicInfo p.episodeStitle").first().text().trim() ||
        el.text().trim();
      const dateText = el.find(".comicInfo .episodeDate").first().text().trim();
      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name, elements.length - index),
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });
    // Source lists chapters newest-first; reverse to ascending
    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("#comicContent img").each((_, element) => {
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

  private parseChapterNumber(name: string, fallback: number): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    // Format MMM dd, yyyy
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }
}

export const HeyToon = new HeyToonExtension();
