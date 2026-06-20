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
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, HotComicsSettingsForm } from "./settings";
import {
  HotComicsBrowseOption,
  HotComicsSearchForm,
  HotComicsSearchMeta,
} from "./forms";

export interface HotComicsConfig {
  name: string;
  baseUrl: string;
  browseList: HotComicsBrowseOption[];
  contentRating?: ContentRating;
  langCode?: string;
}

interface HotComicsSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

class HotComicsInterceptor extends PaperbackInterceptor {
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
    // Age verification gate cookie used by the site.
    request.cookies = {
      ...request.cookies,
      hc_vfs: "Y",
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

type HotComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class HotComicsExtension implements HotComicsImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly browseList: HotComicsBrowseOption[];
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: HotComicsInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: HotComicsConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.browseList = config.browseList;
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new HotComicsInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new HotComicsSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        title: "New",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let path: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    switch (section.id) {
      case "popular_section":
        path = "en";
        itemType = "featuredCarouselItem";
        break;
      case "latest_section":
        path = "en/new";
        itemType = "simpleCarouselItem";
        break;
      default:
        return { items: [] };
    }

    const url = `${this.baseUrl}/${path}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    this.eachListItem($, (mangaId, title, image) => {
      if (seen.has(mangaId)) return;
      seen.add(mangaId);
      items.push({
        type: itemType,
        mangaId,
        imageUrl: image,
        title,
        metadata: undefined,
      });
    });

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: HotComicsSearchMeta })
      ?.searchMeta;
    return new HotComicsSearchForm(this.browseList, meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as HotComicsSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const titleQuery = (query.title || "").trim();
    const searchMeta = (query.metadata as { searchMeta?: HotComicsSearchMeta })
      ?.searchMeta;
    const browsePath = searchMeta?.browse?.[0] ?? "en";

    let url: string;
    let paginated = false;
    if (titleQuery) {
      url = new URLBuilder(this.baseUrl)
        .addPath("en")
        .addPath("search")
        .addQuery("keyword", encodeURIComponent(titleQuery))
        .build();
    } else {
      url = new URLBuilder(this.baseUrl)
        .addPath(browsePath)
        .addQuery("page", page)
        .build();
      paginated = true;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    this.eachListItem($, (mangaId, title, image) => {
      if (seen.has(mangaId)) return;
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
      paginated &&
      $("div.pagination a.vnext:not(.disabled)").length > 0 &&
      page < HotComicsExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata: hasNextPage
        ? { page: page + 1, collectedIds: [...seen] }
        : undefined,
    };
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, image: string) => void,
  ): void {
    $("li[itemtype*=ComicSeries]:not(.no-comic) > a").each((_, element) => {
      const link = $(element);
      const href = link.attr("href") || "";
      const mangaId = this.parseId(href);
      const title = link.find("div.main-text > h4.title").first().text().trim();
      const image = this.imageFromElement(link.find("div.visual img").first());
      if (mangaId && title) {
        cb(mangaId, title, image);
      }
    });
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h2.episode-title").first().text().trim();
    const image = this.imageFromElement($("div.visual img").first());

    const typeBox = $("p.type_box").first();
    let author = typeBox.find("span.writer").first().text().trim();
    const cIdx = author.indexOf("ⓒ");
    if (cIdx !== -1) author = author.slice(cIdx + 1).trim();

    const genres: string[] = [];
    const typeText = typeBox.find("span.type").first().text().trim();
    if (typeText) {
      for (const g of typeText.split("/")) {
        const t = g.trim();
        if (t) genres.push(t);
      }
    }

    const dateText = typeBox.find("span.date").first().text().trim();
    let status = "Ongoing";
    if (!dateText) status = "Unknown";
    else if (dateText === "End" || dateText === "Ende") status = "Completed";

    let description = "";
    const header = $("div.episode-contents header").first().text().trim();
    if (header) description += `${header}\n\n`;
    const sub = $("div.title_content > h2:not(.episode-title)")
      .first()
      .text()
      .trim();
    if (sub) description += sub;
    description = description.trim();

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
        author: author || undefined,
        synopsis: description,
        contentRating: this.contentRating,
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
    const url = this.getMangaShareUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $("#tab-chapter a").each((_, element) => {
      const el = $(element);
      const onclick = el.attr("onclick") || "";
      const marker = "popupLogin('";
      const start = onclick.indexOf(marker);
      if (start === -1) return;
      const rest = onclick.slice(start + marker.length);
      const href = rest.slice(0, rest.indexOf("'"));
      if (!href) return;

      const chapterId = this.parseId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find(".cell-num").first().text().trim();
      const dateText = el.find(".cell-time").first().text().trim();

      let chapNum = 0;
      const numMatch = name.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) chapNum = parseFloat(numMatch[1]);

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

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${this.baseUrl}/${this.safeDecode(chapter.chapterId)}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("#viewer-img img").each((_, element) => {
      const image = this.imageFromElement($(element));
      if (image) pages.push(image);
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return `${this.baseUrl}/${this.safeDecode(mangaId)}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseId(href: string): string {
    let cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    cleaned = cleaned.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
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

  private imageFromElement(img: Cheerio<AnyNode>): string {
    if (!img || img.length === 0) return "";
    let src = img.attr("data-src") || img.attr("src") || "";
    src = src.trim().replace(/#.*$/, "");
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date(0);
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date(0);
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

