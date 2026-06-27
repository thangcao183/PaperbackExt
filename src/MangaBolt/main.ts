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
import { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://mangabolt.com";

// The popular/search listing page has no cover images, so use the site logo
// as a placeholder (Paperback requires a non-empty imageUrl for list items).
const PLACEHOLDER_COVER =
  "https://imagizer.imageshack.com/img922/7118/ArGMjt.png";

interface MangaBoltMetadata {
  page?: number;
}

class MangaBoltInterceptor extends PaperbackInterceptor {
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

type MangaBoltImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaBoltExtension implements MangaBoltImplementation {
  requestManager = new MangaBoltInterceptor("main");
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
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "latest") {
      const $ = await this.fetchCheerio({
        url: `${BASE_URL}/latest`,
        method: "GET",
      });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $("div.bg-bg-secondary:has(a[href*=/chapter/])").each((_, element) => {
        const parsed = this.parseLatestItem($, element);
        if (!parsed || seen.has(parsed.mangaId)) return;
        seen.add(parsed.mangaId);
        items.push({
          type: "simpleCarouselItem",
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          metadata: undefined,
        });
      });
      return { items, metadata: undefined };
    }

    // popular
    const popular = await this.fetchPopularList();
    const items: DiscoverSectionItem[] = popular.map((m) => ({
      type: "featuredCarouselItem",
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search (client-side filter of the popular list)
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const popular = await this.fetchPopularList();

    const results: SearchResultItem[] = popular
      .filter((m) => m.title.toLowerCase().includes(titleQuery))
      .map((m) => ({
        mangaId: m.mangaId,
        imageUrl: m.imageUrl,
        title: m.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items: results, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("#main-content h1").first().text().trim() || this.safeDecode(mangaId);
    const synopsis = $(
      "div.bg-bg-secondary div.px-6 div.flex-col div.text-text-muted",
    )
      .first()
      .text()
      .trim();
    const thumbnailUrl =
      this.absoluteUrl($("div.flex img").first().attr("src") || "") ||
      PLACEHOLDER_COVER;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: "Unknown",
        tagGroups: [] as TagSection[],
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
    const elements = $(
      "div.w-full div.bg-bg-secondary:has(div.grid)",
    ).toArray();
    elements.forEach((element, index) => {
      const el = $(element);
      const link = el.find("div.grid a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      let name = link.text().trim();
      const secondaryTitle = el.find(".text-xs").first().text().trim();
      if (
        secondaryTitle &&
        secondaryTitle.toUpperCase() !== "READ" &&
        secondaryTitle.toLowerCase() !== name.toLowerCase()
      ) {
        name += ` - ${secondaryTitle}`;
      }

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name, elements.length - index),
        publishDate: new Date(0),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    const seen = new Set<string>();
    $(".js-pages-container img.js-page").each((_, element) => {
      const el = $(element);
      if (el.closest("noscript").length > 0) return;
      const raw = el.attr("data-src") || el.attr("src") || "";
      const src = this.absoluteUrl(raw);
      if (!src || src.includes("data:image") || seen.has(src)) return;
      seen.add(src);
      pages.push(src);
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

  private async fetchPopularList(): Promise<
    { mangaId: string; title: string; imageUrl: string }[]
  > {
    const $ = await this.fetchCheerio({
      url: `${BASE_URL}/storage/manga-list.html`,
      method: "GET",
    });

    const list: { mangaId: string; title: string; imageUrl: string }[] = [];
    const seen = new Set<string>();
    $(".section-header, .menu-item").each((_, element) => {
      const el = $(element);
      const onclick = el.attr("onclick") || "";
      const start = onclick.indexOf("'");
      if (start < 0) return;
      const end = onclick.indexOf("'", start + 1);
      if (end < 0) return;
      const path = onclick.substring(start + 1, end);
      if (!path) return;

      const title = el
        .find("h2, .item-title")
        .text()
        .replace(/🔥/g, "")
        .trim();
      if (!title) return;

      const mangaId = this.parsePath(path);
      if (seen.has(mangaId)) return;
      seen.add(mangaId);
      list.push({ mangaId, title, imageUrl: PLACEHOLDER_COVER });
    });

    return list;
  }

  private parseLatestItem(
    $: CheerioAPI,
    element: AnyNode,
  ): { mangaId: string; title: string; imageUrl: string } | undefined {
    const el = $(element);
    const link = el.find("a[href*=/chapter/]").first().attr("href") || "";
    if (!link) return undefined;

    const afterChapter = link.split("/chapter/")[1] || "";
    const slug = afterChapter.split("-chapter-")[0] || "";
    if (!slug) return undefined;

    const title =
      el.find(".font-bold").text().split("Chapter")[0]?.trim() || "";
    if (!title) return undefined;

    const imageUrl =
      this.absoluteUrl(el.find("img").first().attr("src") || "") ||
      PLACEHOLDER_COVER;

    return { mangaId: this.parsePath(`/manga/${slug}/`), title, imageUrl };
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

  private parseChapterNumber(name: string, fallback: number): number {
    const match = name.match(/chapter\s*(\d+(?:\.\d+)?)/i) || name.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : fallback;
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

export const MangaBolt = new MangaBoltExtension();
