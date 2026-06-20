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
import { getBaseUrlOverride, MangaReaderSettingsForm } from "./settings";
import {
  MangaReaderSearchForm,
  MangaReaderSearchMeta,
  SORT_OPTIONS,
} from "./forms";

export interface MangaReaderConfig {
  name: string;
  baseUrl: string;
  /**
   * CSS selector for page images on the ajax reader fragment.
   * Defaults to the MangaReader base class selector.
   */
  pageListSelector?: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface MangaReaderSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

class MangaReaderInterceptor extends PaperbackInterceptor {
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

type MangaReaderImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaReaderExtension implements MangaReaderImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly pageListSelector: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MangaReaderInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangaReaderConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.pageListSelector =
      config.pageListSelector ?? ".container-reader-chapter > div > img";
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangaReaderInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaReaderSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        return this.getListItems("most-viewed", "featuredCarouselItem");
      case "latest_section":
        return this.getListItems("latest-updated", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getListItems(
    sort: string,
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const url = new URLBuilder(this.baseUrl)
      .addPath("filter")
      .addQuery("sort", sort)
      .addQuery("page", 1)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    $(".manga_list-sbs .manga-poster").each((_, element) => {
      const link = $(element);
      const href = link.attr("href") || "";
      const img = link.find("img").first();
      const title = (img.attr("alt") || "").trim();
      const mangaId = this.parsePath(href);
      const image = this.imageFromElement(img);

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
    return SORT_OPTIONS.map((o) => ({ id: o.id, label: o.title }));
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: MangaReaderSearchMeta })
      ?.searchMeta;
    return new MangaReaderSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaReaderSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const titleQuery = (query.title || "").trim();
    const searchMeta = (query.metadata as { searchMeta?: MangaReaderSearchMeta })
      ?.searchMeta;

    const sortId = sortingOption?.id ?? "";
    const filterSort = searchMeta?.sort?.[0] ?? "";

    let builder: URLBuilder;
    if (titleQuery) {
      builder = new URLBuilder(this.baseUrl)
        .addPath("search")
        .addQuery("keyword", titleQuery)
        .addQuery("page", page);
    } else {
      builder = new URLBuilder(this.baseUrl)
        .addPath("filter")
        .addQuery("sort", sortId || filterSort || "most-viewed")
        .addQuery("page", page);
    }

    const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    $(".manga_list-sbs .manga-poster").each((_, element) => {
      const link = $(element);
      const href = link.attr("href") || "";
      const img = link.find("img").first();
      const title = (img.attr("alt") || "").trim();
      const mangaId = this.parsePath(href);
      const image = this.imageFromElement(img);

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

    const hasNextPage =
      $("ul.pagination > li.active + li").length > 0;
    const reachedLimit = page >= MangaReaderExtension.MAX_SEARCH_PAGES;

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

    const detail = $("#ani_detail").first();
    const title = detail.find(".manga-name").first().contents().filter((_, n) => n.type === "text").text().trim()
      || detail.find(".manga-name").first().text().trim();
    const image = this.imageFromElement(detail.find("img").first());

    const genres: string[] = [];
    detail.find(".genres > a").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const altTitle = detail.find(".manga-name-or").first().text().trim();
    let description = detail.find(".description").first().text().trim();
    if (altTitle && altTitle !== title) {
      description += `\n\nAlternative Title: ${altTitle}`;
    }
    description = description.trim();

    let author: string | undefined;
    let artist: string | undefined;
    let statusText = "";

    detail.find(".anisc-info > .item").each((_, item) => {
      const head = $(item).find(".item-head").first().text().trim();
      if (head === "Authors:") {
        const names: string[] = [];
        $(item)
          .find(".name")
          .each((_, n) => {
            const t = $(n).text().replace(/,/g, "").trim();
            if (t) names.push(t);
          });
        if (names.length > 0) author = names.join(", ");
      } else if (head === "Status:") {
        statusText = $(item).find(".name").first().text().trim();
      }
    });

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
        secondaryTitles: altTitle && altTitle !== title ? [altTitle] : [],
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

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const elements = $("#en-chapters > li.chapter-item").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const dataId = el.attr("data-id") || "";
      const path = this.stripDomain(href);
      const chapterId = this.toSafeId(`${path}#${dataId}`);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const name =
        el.find(".name").first().text().trim() || link.text().trim();

      let chapNum = -1;
      const numMatch = name.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        chapNum = elements.length - index;
      }

      chapters.push({
        chapterId,
        sourceManga,
        title: name || `Chapter ${chapNum}`,
        volume: 0,
        chapNum,
        publishDate: new Date(0),
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const hashIdx = decoded.lastIndexOf("#");
    const chapterPath = hashIdx !== -1 ? decoded.slice(0, hashIdx) : decoded;
    let readingId = hashIdx !== -1 ? decoded.slice(hashIdx + 1) : "";

    // Resolve the reading id from the chapter page if not embedded.
    if (!readingId) {
      const chapterUrl = `${this.baseUrl}${
        chapterPath.startsWith("/") ? "" : "/"
      }${chapterPath}`;
      const $page = await this.fetchCheerio({ url: chapterUrl, method: "GET" });
      readingId = $page("div[data-reading-id]").first().attr("data-reading-id") || "";
      if (!readingId) {
        throw new Error("Unable to retrieve chapter id");
      }
    }

    const chapterShareUrl = `${this.baseUrl}${
      chapterPath.startsWith("/") ? "" : "/"
    }${chapterPath}`;
    const ajaxUrl = `${this.baseUrl}//ajax/image/list/${readingId}?mode=vertical`;

    const json = await this.fetchJson<{ html?: string }>({
      url: ajaxUrl,
      method: "GET",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        referer: encodeURIComponent(chapterShareUrl),
        "x-requested-with": "XMLHttpRequest",
      },
    });

    const $ = cheerio.load(htmlparser2.parseDocument(json.html || ""));
    const pages: string[] = [];

    $(this.pageListSelector).each((_, element) => {
      let image = this.imageFromElement($(element));
      if (!image) {
        image = this.imageFromElement($(element).find("img").first());
      }
      if (image) pages.push(image);
    });

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
      img.attr("data-url") ||
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
    if (
      s.includes("ongoing") ||
      s.includes("publishing") ||
      s.includes("releasing")
    )
      return "Ongoing";
    if (s.includes("completed") || s.includes("finished")) return "Completed";
    if (s.includes("hiatus") || s.includes("hold")) return "Hiatus";
    if (s.includes("cancel") || s.includes("discontinued")) return "Cancelled";
    return "Unknown";
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}
