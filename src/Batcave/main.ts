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
import { BatCaveSearchForm, BatCaveSearchMeta } from "./forms";

const BASE_URL = "https://batcave.biz";

interface BatCaveMetadata {
  page?: number;
}

interface BatCaveChapter {
  id: number;
  posi: number;
  title: string;
  date: string;
}

interface BatCaveChaptersData {
  news_id: number;
  chapters: BatCaveChapter[];
  xhash: string;
}

interface BatCaveImagesData {
  images: string[];
}

class BatCaveInterceptor extends PaperbackInterceptor {
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

type BatCaveImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class BatCaveExtension implements BatCaveImplementation {
  requestManager = new BatCaveInterceptor("main");
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
      | { searchMeta?: BatCaveSearchMeta }
      | undefined;
    return new BatCaveSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as BatCaveMetadata | undefined;
    const page = meta?.page ?? 1;

    // Popular -> sort "rating" desc, Latest -> sort "editdate" desc, both POST to /comix/.
    const sort = section.id === "popular" ? "rating" : "editdate";
    const $ = await this.fetchBrowse(page, sort, "desc");

    const items: DiscoverSectionItem[] = [];
    const itemType =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    this.eachListItem($, (parsed) => {
      items.push({
        type: itemType,
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as BatCaveMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: BatCaveSearchMeta } | undefined
    )?.searchMeta;

    let $: CheerioAPI;
    if (titleQuery) {
      // Text search: GET /search/{query}/[page/N/]
      let url = `${BASE_URL}/search/${encodeURIComponent(titleQuery)}`;
      if (page > 1) url += `/page/${page}/`;
      $ = await this.fetchCheerio({ url, method: "GET" });
    } else {
      // Filter browse.
      $ = await this.fetchFilterBrowse(searchMeta, page);
    }

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

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async fetchBrowse(
    page: number,
    sort: string,
    direction: string,
  ): Promise<CheerioAPI> {
    let url = `${BASE_URL}/comix/`;
    if (page > 1) url += `page/${page}/`;

    if (!sort) {
      return this.fetchCheerio({ url, method: "GET" });
    }

    const body = [
      `dlenewssortby=${encodeURIComponent(sort)}`,
      `dledirection=${encodeURIComponent(direction)}`,
      "set_new_sort=dle_sort_cat_1",
      "set_direction_sort=dle_direction_cat_1",
    ].join("&");

    return this.fetchCheerioPost(url, body);
  }

  private async fetchFilterBrowse(
    searchMeta: BatCaveSearchMeta | undefined,
    page: number,
  ): Promise<CheerioAPI> {
    let filterPath = "";
    const yearFrom = (searchMeta?.yearFrom ?? "").trim();
    const yearTo = (searchMeta?.yearTo ?? "").trim();
    if (yearFrom) filterPath += `y[from]=${encodeURIComponent(yearFrom)}/`;
    if (yearTo) filterPath += `y[to]=${encodeURIComponent(yearTo)}/`;
    const filtersApplied = filterPath.length > 0;

    let url = BASE_URL;
    if (filtersApplied) {
      url += `/ComicList/${filterPath}`;
    } else {
      url += "/comix/";
    }
    if (page > 1) url += `page/${page}/`;

    const sort = searchMeta?.sort?.[0] ?? "";
    const direction = searchMeta?.direction?.[0] ?? "desc";

    if (!sort) {
      return this.fetchCheerio({ url, method: "GET" });
    }

    const setSort = filtersApplied ? "dle_sort_xfilter" : "dle_sort_cat_1";
    const setDir = filtersApplied
      ? "dle_direction_xfilter"
      : "dle_direction_cat_1";
    const body = [
      `dlenewssortby=${encodeURIComponent(sort)}`,
      `dledirection=${encodeURIComponent(direction)}`,
      `set_new_sort=${setSort}`,
      `set_direction_sort=${setDir}`,
    ].join("&");

    return this.fetchCheerioPost(url, body);
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (parsed: {
      mangaId: string;
      title: string;
      imageUrl: string;
    }) => void,
  ): void {
    $("#dle-content > .readed").each((_, element) => {
      const el = $(element);
      const link = el.find(".readed__title > a").first();
      const href = link.attr("href") || "";
      const title = link.clone().children().remove().end().text().trim();
      if (!href || !title) return;
      const img = el.find("img").first();
      const imageUrl = this.absoluteUrl(
        img.attr("data-src") || img.attr("src") || "",
      );
      cb({ mangaId: this.parsePath(href), title, imageUrl });
    });
  }

  private hasNextPage($: CheerioAPI): boolean {
    const lastChild = $("div.pagination__pages").children().last();
    return lastChild.length > 0 && lastChild.prop("tagName") === "A";
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("header.page__header h1").first().text().trim() ||
      this.safeDecode(mangaId);
    const thumbnailUrl = this.absoluteUrl(
      $("div.page__poster img").first().attr("src") || "",
    );
    const synopsis = $("div.page__text").first().text().trim();
    const author = this.ownText(
      $(".page__list > li:has(> div:contains(Writer))").first(),
    );
    const artist = this.ownText(
      $(".page__list > li:has(> div:contains(Artist))").first(),
    );
    const statusText = this.ownText(
      $(".page__list > li:has(> div:contains(Release type))").first(),
    );

    const genres = $("div.page__tags a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
    genres.push("Comic");

    const tagGroups: TagSection[] = [
      {
        id: "genres",
        title: "Genres",
        tags: genres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      },
    ];

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

    const data = this.extractData<BatCaveChaptersData>($);
    if (!data) return [];

    const chapters: Chapter[] = [];
    for (const chap of data.chapters ?? []) {
      chapters.push({
        chapterId: `reader/${data.news_id}/${chap.id}${data.xhash}`,
        sourceManga,
        title: chap.title,
        volume: 0,
        chapNum: chap.posi,
        publishDate: this.parseDate(chap.date),
        langCode: "🇬🇧",
      });
    }
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const data = this.extractData<BatCaveImagesData>($);
    const pages: string[] = [];
    for (const img of data?.images ?? []) {
      const trimmed = (img || "").trim();
      if (!trimmed) continue;
      pages.push(
        trimmed.startsWith("http") ? trimmed : `${BASE_URL}${trimmed}`,
      );
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

  private extractData<T>($: CheerioAPI): T | undefined {
    const scripts = $("script")
      .map((_, el) => $(el).html() || "")
      .get();
    const script = scripts.find((s) => s.includes("window.__DATA__"));
    if (!script) return undefined;
    const raw = script
      .substring(script.indexOf("window.__DATA__ = ") + "window.__DATA__ = ".length)
      .trim();
    const jsonStr = raw.substring(0, raw.lastIndexOf(";"));
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      return undefined;
    }
  }

  private ownText(el: Cheerio<AnyNode>): string {
    return el.clone().children().remove().end().text().trim();
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

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    return "Unknown";
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    // Format dd.MM.yyyy
    const m = dateText.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      if (!isNaN(d.getTime())) return d;
    }
    const fallback = new Date(dateText);
    return isNaN(fallback.getTime()) ? new Date(0) : fallback;
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
    return this.fetchCheerio({
      url,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
  }
}

export const Batcave = new BatCaveExtension();
