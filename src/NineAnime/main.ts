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
import { NineAnimeSearchForm, NineAnimeSearchMeta } from "./forms";

const BASE_URL = "https://www.nineanime.com";
const IMAGE_URL_REGEX = /["'](http[^"']+)["']/g;

interface NineAnimeMetadata {
  page?: number;
}

class NineAnimeInterceptor extends PaperbackInterceptor {
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

type NineAnimeImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class NineAnimeExtension implements NineAnimeImplementation {
  requestManager = new NineAnimeInterceptor("main");
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
      | { searchMeta?: NineAnimeSearchMeta }
      | undefined;
    return new NineAnimeSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as NineAnimeMetadata | undefined;
    const page = meta?.page ?? 1;

    const sort = section.id === "popular" ? "views" : "updated";
    const url = `${BASE_URL}/category/index_${page}.html?sort=${sort}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const itemType =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    this.eachListItem($, (mangaId, title, imageUrl) => {
      items.push({ type: itemType, mangaId, imageUrl, title, metadata: undefined });
    });

    const hasNextPage = $("a.next").length > 0;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as NineAnimeMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: NineAnimeSearchMeta } | undefined
    )?.searchMeta;

    let url: string;
    if (titleQuery) {
      url = `${BASE_URL}/search/?name=${encodeURIComponent(
        titleQuery,
      )}&page=${page}.html`;
    } else {
      const genre = searchMeta?.genre?.[0] ?? "";
      if (genre && genre !== "All") {
        url = `${BASE_URL}/category/${genre}_${page}.html`;
      } else {
        url = `${BASE_URL}/category/index_${page}.html?sort=views`;
      }
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

    const hasNextPage = $("a.next").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, imageUrl: string) => void,
  ): void {
    $("div.post").each((_, element) => {
      const el = $(element);
      const link = el.find("p.title a").first();
      const href = link.attr("href") || "";
      const title = link.text().trim();
      if (!href || !title) return;
      const imageUrl = this.imageFromElement(el.find("img").first());
      cb(this.parsePath(href), title, imageUrl);
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const top = $("div.manga-detailtop");
    const thumbnailUrl = this.imageFromElement(
      top.find("img.detail-cover").first(),
    );
    const author = top
      .find("span:contains(Author) + a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((s) => s.length > 0)
      .join(", ");
    const artist = top
      .find("span:contains(Artist) + a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((s) => s.length > 0)
      .join(", ");
    const statusText = top
      .find("p:has(span:contains(Status))")
      .first()
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .trim();

    const middle = $("div.manga-detailmiddle");
    const genres = middle
      .find("p:has(span:contains(Genre)) a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
    const synopsis = middle.find("p.mobile-none").first().text().trim();

    const title = top.find("img.detail-cover").attr("alt")?.trim() ||
      $("h1").first().text().trim() ||
      this.safeDecode(mangaId);

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
    const url = `${this.mangaUrl(sourceManga.mangaId)}?waring=1`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    $("ul.detail-chlist li").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const name =
        link.find("span").first().text().trim() || link.text().trim();
      const dateText = el.find("span.time").text().trim();
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
    const baseChapterUrl = this.chapterUrl(chapter.chapterId).replace(
      /\/+$/,
      "",
    );
    const firstUrl = `${baseChapterUrl}-10-1.html`;
    const { $, finalUrl } = await this.fetchCheerioWithUrl({
      url: firstUrl,
      method: "GET",
    });

    // External routing pipeline: iframe -> jump page -> all_imgs_url script.
    const external = await this.tryExternalPages(finalUrl);
    if (external.length > 0) {
      return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages: external,
      };
    }

    // Native fallback.
    const pages: string[] = [];
    $("img.manga_pic").each((_, el) => {
      const src = this.imageFromElement($(el));
      if (src) pages.push(src);
    });

    const optionUrls: string[] = [];
    $("select.sl-page option").each((i, el) => {
      if (i === 0) return;
      const val = $(el).attr("value") || "";
      const abs = this.absoluteUrl(val);
      if (abs) optionUrls.push(abs);
    });

    for (const pageUrl of optionUrls) {
      const $page = await this.fetchCheerio({ url: pageUrl, method: "GET" });
      $page("img.manga_pic").each((_, el) => {
        const src = this.imageFromElement($page(el));
        if (src) pages.push(src);
      });
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  private async tryExternalPages(finalUrl: string): Promise<string[]> {
    try {
      const cid = finalUrl
        .split("-10-1")[0]
        .split("?")[0]
        .replace(/\/+$/, "")
        .split("/")
        .pop();
      if (!cid) return [];

      const iframeUrl = `${BASE_URL}/chapter/iframe_views/${cid}`;
      const $iframe = await this.fetchCheerio({
        url: iframeUrl,
        method: "GET",
      });

      const jumpUrl = this.absoluteUrl(
        $iframe("a.vision-button").first().attr("href") || "",
      );
      if (!jumpUrl) return [];

      const jumpHtml = await this.fetchString({ url: jumpUrl, method: "GET" });
      const $jump = cheerio.load(htmlparser2.parseDocument(jumpHtml));
      let scriptData = "";
      $jump("script").each((_, el) => {
        const d = $jump(el).text();
        if (d.includes("all_imgs_url")) scriptData = d;
      });
      if (!scriptData) return [];

      const arrayString = scriptData
        .split("all_imgs_url: [")[1]
        ?.split("]")[0];
      if (!arrayString) return [];

      const urls: string[] = [];
      let m: RegExpExecArray | null;
      IMAGE_URL_REGEX.lastIndex = 0;
      while ((m = IMAGE_URL_REGEX.exec(arrayString)) !== null) {
        urls.push(m[1].replace(/\\\//g, "/"));
      }
      return urls;
    } catch {
      return [];
    }
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const raw =
      img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src") || "";
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
    if (s.includes("completed")) return "Completed";
    return "Unknown";
  }

  private parseDate(text: string): Date {
    const t = (text || "").trim();
    if (!t) return new Date(0);
    if (t.toLowerCase().includes("ago")) {
      const split = t.split(" ");
      if (split.length < 2) return new Date(0);
      const amount = parseInt(split[0], 10);
      if (isNaN(amount)) return new Date(0);
      const unit = split[1].toLowerCase();
      const now = Date.now();
      if (unit.includes("minute")) return new Date(now - amount * 60 * 1000);
      if (unit.includes("hour")) return new Date(now - amount * 60 * 60 * 1000);
      if (unit.includes("day"))
        return new Date(now - amount * 24 * 60 * 60 * 1000);
      return new Date(0);
    }
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

  async fetchCheerioWithUrl(
    request: Request,
  ): Promise<{ $: CheerioAPI; finalUrl: string }> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(htmlStr);
    return { $: cheerio.load(dom), finalUrl: response.url || request.url };
  }

  async fetchString(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
  }
}

export const NineAnime = new NineAnimeExtension();
