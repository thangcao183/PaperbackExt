import {
  BasicRateLimiter,
  AdvancedSearchForm,
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
  Form,
  MangaProviding,
  Metadata,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SettingsFormProviding,
  SortingOption,
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, PaprikaSettingsForm } from "./settings";
import { PaprikaSearchForm, PaprikaSearchMeta, ORDER_BY_OPTIONS } from "./forms";

export interface PaprikaConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface PaprikaSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

class PaprikaInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    request.headers = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
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

type PaprikaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class PaprikaExtension implements PaprikaImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: PaprikaInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: PaprikaConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new PaprikaInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new PaprikaSettingsForm(this.sourceName, this.defaultBaseUrl);
  }

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
        id: "popular_section",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest_section",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "popular_section":
        return this.getListItems("popular-manga", "featuredCarouselItem");
      case "latest_section":
        return this.getListItems("latest-manga", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getListItems(
    path: string,
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(path)
      .addQuery("page", 1)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    $("div.anipost").each((_, element) => {
      const el = $(element);
      const a = el.find("a:has(h3)").first();
      const href = a.attr("href") || "";
      const title = a.text().trim();
      const mangaId = this.parsePath(href);
      const image = this.imageFromElement(el.find("img").first());

      if (title && mangaId && !seen.has(mangaId)) {
        seen.add(mangaId);
        items.push({
          type: itemType,
          mangaId,
          imageUrl: image,
          title,
          metadata: undefined,
        });
      }
    });

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return ORDER_BY_OPTIONS.map((o) => ({ id: o.id, label: o.title }));
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: PaprikaSearchMeta })
      ?.searchMeta;
    return new PaprikaSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as PaprikaSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const titleQuery = (query.title || "").trim();
    const searchMeta = (query.metadata as { searchMeta?: PaprikaSearchMeta })
      ?.searchMeta;

    const sortId = sortingOption?.id ?? "";
    const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";

    let builder: URLBuilder;
    if (titleQuery) {
      builder = new URLBuilder(this.baseUrl)
        .addPath("search")
        .addQuery("s", titleQuery)
        .addQuery("post_type", "manga")
        .addQuery("page", page);
    } else {
      builder = new URLBuilder(this.baseUrl).addPath("genres");
      const orderBy = sortId || filterOrderBy;
      if (orderBy) {
        builder = builder.addQuery("orderby", orderBy);
      }
      builder = builder.addQuery("page", page);
    }

    const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    $("div.anipost").each((_, element) => {
      const el = $(element);
      const a = el.find("a:has(h3)").first();
      const href = a.attr("href") || "";
      const title = a.text().trim();
      const mangaId = this.parsePath(href);
      const image = this.imageFromElement(el.find("img").first());

      if (!title || !mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      results.push({
        mangaId,
        imageUrl: image,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $("a[rel=next]").length > 0;
    const reachedLimit = page >= PaprikaExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedLimit
          ? { page: page + 1, collectedIds: [...seen] }
          : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $(".animeinfo .rm h1").first().text().trim();
    const image = this.imageFromElement($(".animeinfo .lm img").first());

    let author: string | undefined;
    let artist: string | undefined;
    let genreString = "";
    let statusText = "";

    $(".listinfo li").each((_, element) => {
      const text = $(element).text().trim();
      if (text.startsWith("Author")) {
        author = this.afterColon(text);
      } else if (text.startsWith("Artist")) {
        artist = this.afterColon(text).replace(/;/g, ",");
      } else if (text.startsWith("Genre")) {
        genreString = this.afterColon(text).replace(/;/g, ",");
      } else if (text.startsWith("Status")) {
        statusText = this.afterColon(text);
      }
    });

    const description = $("#noidungm")
      .map((_, el) => $(el).text().trim())
      .toArray()
      .join("\n")
      .trim();

    const genres = genreString
      .split(",")
      .map((g) => g.trim())
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
        thumbnailUrl: image,
        author,
        artist,
        synopsis: description,
        contentRating: this.contentRating,
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
    const mangaUrl = this.getMangaShareUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    const mangaTitle = $(".animeinfo .rm h1").first().text().trim();

    // Extract the numeric manga id embedded in a <script> on the detail page.
    let mangaScriptId = "";
    $("script").each((_, element) => {
      const data = $(element).html() || "";
      if (data.includes("var mangaID")) {
        const m = data.match(/var mangaID\s*=\s*'([^']+)'/);
        if (m) mangaScriptId = m[1];
      }
    });

    let $list: CheerioAPI;
    if (mangaScriptId) {
      const ajaxUrl = new URLBuilder(this.baseUrl)
        .addPath("ajax-list-chapter")
        .addQuery("mangaID", mangaScriptId)
        .build();
      $list = await this.fetchCheerio({ url: ajaxUrl, method: "GET" });
    } else {
      $list = $;
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const elements = $list("li").toArray();

    elements.forEach((element, index) => {
      const el = $list(element);
      const leftoff = el.find(".leftoff").first();
      const a = leftoff.find("a").first();
      const href = a.attr("href") || "";
      if (!href) return;

      const chapterId = this.parsePath(href);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      let name = leftoff.text().trim();
      if (mangaTitle && name.startsWith(mangaTitle)) {
        name = name.slice(mangaTitle.length).trim();
      }

      let chapNum = -1;
      const numMatch = name.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        chapNum = elements.length - index;
      }

      const dateText = el.find(".rightoff").first().text().trim();

      chapters.push({
        chapterId,
        sourceManga,
        title: name || `Chapter ${chapNum}`,
        volume: 0,
        chapNum,
        publishDate: this.parseDate(dateText),
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.getMangaShareUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url: chapterUrl, method: "GET" });

    const arraydata = $("#arraydata").first().text().trim();
    const pages: string[] = [];
    if (arraydata.length > 0) {
      arraydata.split(",").forEach((raw) => {
        let img = raw.trim();
        if (!img) return;
        if (!img.startsWith("http")) {
          img = img.startsWith("/")
            ? `${this.baseUrl}${img}`
            : `${this.baseUrl}/${img}`;
        }
        pages.push(img);
      });
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const path = this.safeDecode(mangaId);
    return `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private stripDomain(href: string): string {
    let cleaned = href.replace(/[?#].*$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    if (!cleaned.startsWith("/")) cleaned = `/${cleaned}`;
    return cleaned.replace(/\/+$/, "");
  }

  private afterColon(text: string): string {
    const idx = text.indexOf(":");
    return idx === -1 ? text.trim() : text.slice(idx + 1).trim();
  }

  private parsePath(href: string): string {
    return this.toSafeId(this.stripDomain(href));
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

  private imageFromElement(img: Cheerio<AnyNode>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-lazy-src") ||
      img.attr("data-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    src = src.trim().replace(/#.*$/, "");
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }

  private parseStatus(status: string): string {
    const s = status.toLowerCase().trim();
    if (!s) return "Unknown";
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus") || s.includes("hold")) return "Hiatus";
    if (s.includes("cancel") || s.includes("discontinued")) return "Cancelled";
    return "Unknown";
  }

  private parseDate(text: string): Date {
    if (!text) return new Date(0);
    const lower = text.toLowerCase();
    const now = Date.now();

    if (lower.includes("yesterday")) {
      return new Date(now - 24 * 60 * 60 * 1000);
    }

    if (lower.includes("ago")) {
      const m = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/);
      if (m) {
        const num = parseInt(m[1], 10);
        const unit = m[2];
        const ms: Record<string, number> = {
          second: 1000,
          minute: 60 * 1000,
          hour: 60 * 60 * 1000,
          day: 24 * 60 * 60 * 1000,
          week: 7 * 24 * 60 * 60 * 1000,
          month: 30 * 24 * 60 * 60 * 1000,
          year: 365 * 24 * 60 * 60 * 1000,
        };
        return new Date(now - num * (ms[unit] ?? 0));
      }
    }

    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) return parsed;
    return new Date(0);
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
