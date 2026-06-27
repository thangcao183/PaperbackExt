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

const BASE_URL = "https://manhwaread.com";

// Sort modes used by the upstream popular/latest browse flows.
const SORT_POPULAR = "daily_top";
const SORT_LATEST = "release";

const PATTERN_CHAPTER_DATA = /var\s+chapterData\s*=\s*(\{.*\})/;

type ManhwaReadMetadata = {
  page?: number;
};

class ManhwaReadInterceptor extends PaperbackInterceptor {
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

type ManhwaReadImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ManhwaReadExtension implements ManhwaReadImplementation {
  requestManager = new ManhwaReadInterceptor("main");
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
    const meta = metadata as ManhwaReadMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? SORT_POPULAR : SORT_LATEST;
    const url = this.browseUrl(page, "", sort);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".main-container .manga-item").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = $(".wp-pagenavi a.last").length > 0;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    // Upstream supports pasting a manga URL directly as the search query.
    if (titleQuery.startsWith("https://")) {
      const slug = this.slugFromUrl(titleQuery);
      if (slug) {
        const mangaId = this.toSafeId(`manhwa/${slug}`);
        const details = await this.getMangaDetails(mangaId);
        return {
          items: [
            {
              mangaId,
              imageUrl: details.mangaInfo.thumbnailUrl,
              title: details.mangaInfo.primaryTitle,
              subtitle: undefined,
              metadata: undefined,
            },
          ],
          metadata: undefined,
        };
      }
    }

    const meta = metadata as ManhwaReadMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = this.browseUrl(page, titleQuery, SORT_POPULAR);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $(".main-container .manga-item").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $(".wp-pagenavi a.last").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find("a.manga-item__link").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = link.text().trim();
    const imageUrl = this.imageFromElement(
      el.find(".manga-item__img img").first(),
    );
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("#mangaSummary .manga-titles h1").first().text().trim() ||
      this.safeDecode(mangaId);

    const altTitlesRaw = $("#mangaSummary .manga-titles h2").first().text();
    const secondaryTitles = altTitlesRaw
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const artist = $(
      "#mangaSummary .text-primary:contains(Artist:) + .flex a span:first-child",
    )
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((s) => s.length > 0)
      .join(", ");

    const author = $(
      "#mangaSummary .text-primary:contains(Author:) + .flex a span:first-child",
    )
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((s) => s.length > 0)
      .join(", ");

    const synopsis = $("#mangaDesc > .manga-desc__content").first().text().trim();

    const thumbnailUrl = this.absoluteUrl(
      $("head meta[property=og:image]").first().attr("content") || "",
    );

    const siteGenres = $("#mangaSummary .manga-genres a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
    const siteTags = $(
      "#mangaSummary .text-primary:contains(Tags:) + .flex a span:first-child",
    )
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const tagGroups: TagSection[] = [];
    if (siteGenres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: siteGenres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }
    if (siteTags.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: siteTags.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    const statusText =
      $("#mangaSummary .manga-status").first().attr("data-status") || "";

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles,
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

    const entries: { chapterId: string; name: string; date: Date }[] = [];
    const seen = new Set<string>();
    $("#chaptersList > a.chapter-item").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find("span.chapter-item__name").first().text().trim();
      const dateText = el.find("span.chapter-item__date").first().text().trim();
      entries.push({
        chapterId,
        name,
        date: this.parseDate(dateText),
      });
    });

    // Upstream reverses so newest is first.
    entries.reverse();

    return entries.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: this.parseChapterNumber(entry.name, entries.length - index),
      publishDate: entry.date,
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const body = Application.arrayBufferToUTF8String(data);

    const match = body.match(PATTERN_CHAPTER_DATA);
    if (!match || !match[1]) {
      throw new Error("Chapter data not found");
    }

    const chapterData = JSON.parse(match[1]) as { data: string; base: string };
    const decoded = this.base64Decode(chapterData.data);
    const pageList = JSON.parse(decoded) as { src: string }[];

    const pages = pageList.map((page) => `${chapterData.base}/${page.src}`);

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

  private browseUrl(page: number, query: string, sort: string): string {
    const path = page > 1 ? `/page/${page}/` : "/";
    const params: string[] = [];
    params.push(`s=${encodeURIComponent(query)}`);
    params.push(`sortby=${encodeURIComponent(sort)}`);
    params.push("order=desc");
    return `${BASE_URL}${path}?${params.join("&")}`;
  }

  private slugFromUrl(rawUrl: string): string | undefined {
    const cleaned = rawUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const segments = cleaned.replace(/^https?:\/\/[^/]+\//, "").split("/");
    // Expected path: manhwa/<slug>
    return segments[1];
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
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  private parseDate(text: string): Date {
    // Upstream format: dd/MM/yyyy
    const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return new Date(0);
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

  private parseStatus(status: string): string {
    switch (status) {
      case "ongoing":
        return "Ongoing";
      case "completed":
        return "Completed";
      case "canceled":
        return "Cancelled";
      case "on-hold":
        return "Hiatus";
      case "incomplete":
        return "Ongoing";
      default:
        return "Unknown";
    }
  }

  private base64Decode(input: string): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const str = input.replace(/[^A-Za-z0-9+/]/g, "");
    let output = "";
    for (let i = 0; i < str.length; i += 4) {
      const e1 = chars.indexOf(str[i]);
      const e2 = chars.indexOf(str[i + 1]);
      const e3 = chars.indexOf(str[i + 2]);
      const e4 = chars.indexOf(str[i + 3]);
      const c1 = (e1 << 2) | (e2 >> 4);
      const c2 = ((e2 & 15) << 4) | (e3 >> 2);
      const c3 = ((e3 & 3) << 6) | e4;
      output += String.fromCharCode(c1);
      if (e3 !== 64 && e3 !== -1) output += String.fromCharCode(c2);
      if (e4 !== 64 && e4 !== -1) output += String.fromCharCode(c3);
    }
    // The decoded bytes are UTF-8 (the page-list JSON); decode them as such.
    try {
      return decodeURIComponent(
        output
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      );
    } catch {
      return output;
    }
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

export const ManhwaRead = new ManhwaReadExtension();
