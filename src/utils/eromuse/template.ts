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
import { getBaseUrlOverride, EroMuseSettingsForm } from "./settings";

export interface EroMuseConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface EroMuseBrowseMetadata {
  nextUrl?: string;
  collectedIds?: string[];
}

interface EroMuseProfile {
  albumSelector: string;
  popularUrl: (baseUrl: string) => string;
  latestUrl: (baseUrl: string) => string;
  searchUrl: (baseUrl: string, query: string) => string;
  linkedChapterSelector: string;
  pageThumbnailSelector: string;
  thumbSeg: string;
  fullSeg: string;
  genreSelector?: string;
  authorBreadcrumbAuthor: string;
  authorBreadcrumbVarious: string;
}

const NEXT_PAGE_SELECTOR = ".pagination span.current + span a";
const MAX_BROWSE_PAGES = 5;
const MAX_PAGE_FETCHES = 20;

const EIGHTMUSES_PROFILE: EroMuseProfile = {
  albumSelector: "a.c-tile:has(img):not(:has(.members-only))",
  popularUrl: (b) => `${b}/comics/album/Various-Authors`,
  latestUrl: (b) => `${b}/comics/album/Various-Authors?sort=date`,
  searchUrl: (b, q) => `${b}/search?q=${encodeURIComponent(q)}&page=1`,
  linkedChapterSelector: "a.c-tile:has(img)[href*=/comics/album/]",
  pageThumbnailSelector: "a.c-tile:has(img)[href*=/comics/picture/] img",
  thumbSeg: "/th/",
  fullSeg: "/fl/",
  authorBreadcrumbAuthor: "div.top-menu-breadcrumb li:nth-child(2)",
  authorBreadcrumbVarious: "div.top-menu-breadcrumb li:nth-child(3)",
};

const EROFUS_PROFILE: EroMuseProfile = {
  albumSelector: "a.a-click:has(img)",
  popularUrl: (b) => `${b}/comics/various-authors?sort=viewed&page=1`,
  latestUrl: (b) => `${b}/comics/various-authors?sort=recent&page=1`,
  searchUrl: (b, q) => `${b}/?search=${encodeURIComponent(q)}&page=1`,
  linkedChapterSelector: "a.a-click:has(img)[href^=/comics/]",
  pageThumbnailSelector: "a.a-click:has(img)[href*=/pic/] img",
  thumbSeg: "/thumb/",
  fullSeg: "/medium/",
  genreSelector: "div.album-tag-container a",
  authorBreadcrumbAuthor: "div.navigation-breadcrumb li:nth-child(3)",
  authorBreadcrumbVarious: "div.navigation-breadcrumb li:nth-child(5)",
};

class EroMuseInterceptor extends PaperbackInterceptor {
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

type EroMuseImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class EroMuseExtension implements EroMuseImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;
  private readonly profile: EroMuseProfile;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: EroMuseInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: EroMuseConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.MATURE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.profile = this.defaultBaseUrl.includes("erofus")
      ? EROFUS_PROFILE
      : EIGHTMUSES_PROFILE;
    this.requestManager = new EroMuseInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new EroMuseSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        title: "Latest",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as EroMuseBrowseMetadata | undefined;
    let url: string;
    if (meta?.nextUrl) {
      url = meta.nextUrl;
    } else if (section.id === "popular_section") {
      url = this.profile.popularUrl(this.baseUrl);
    } else if (section.id === "latest_section") {
      url = this.profile.latestUrl(this.baseUrl);
    } else {
      return { items: [] };
    }

    const itemType =
      section.id === "popular_section"
        ? "featuredCarouselItem"
        : "simpleCarouselItem";

    const { items, nextUrl, collectedIds } = await this.browse(
      url,
      meta?.collectedIds ?? [],
    );

    const discoverItems: DiscoverSectionItem[] = items.map((it) => ({
      type: itemType,
      mangaId: it.mangaId,
      imageUrl: it.imageUrl,
      title: it.title,
      metadata: undefined,
    }));

    return {
      items: discoverItems,
      metadata: nextUrl ? { nextUrl, collectedIds } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as EroMuseBrowseMetadata | undefined;
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (meta?.nextUrl) {
      url = meta.nextUrl;
    } else if (titleQuery) {
      url = this.profile.searchUrl(this.baseUrl, titleQuery);
    } else {
      url = this.profile.popularUrl(this.baseUrl);
    }

    const { items, nextUrl, collectedIds } = await this.browse(
      url,
      meta?.collectedIds ?? [],
    );

    return {
      items,
      metadata: nextUrl ? { nextUrl, collectedIds } : undefined,
    };
  }

  /**
   * Fetch a listing page and collect album tiles as search results. Pagination
   * follows the EroMuse next-page link, recomputing the URL the same way the
   * Tachiyomi base class does.
   */
  private async browse(
    url: string,
    collectedIds: string[],
  ): Promise<{
    items: SearchResultItem[];
    nextUrl?: string;
    collectedIds: string[];
  }> {
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    $(this.profile.albumSelector).each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const mangaId = this.parseId(href);
      if (!mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      const title = el.text().trim();
      const image = this.imageFromElement(el.find("img").first());
      items.push({
        mangaId,
        imageUrl: image,
        title: title || mangaId,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const reachedLimit = seen.size > MAX_BROWSE_PAGES * 60;
    const nextUrl = reachedLimit ? undefined : this.nextPageUrl($, url);

    return { items, nextUrl, collectedIds: [...seen] };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.absoluteUrl(this.safeDecode(mangaId));
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = this.titleFromId(mangaId);
    const image = this.imageFromElement(
      $(`${this.profile.albumSelector} img`).first(),
    );

    const decoded = this.safeDecode(mangaId);
    const author =
      $(this.profile.authorBreadcrumbAuthor).first().text().trim() ||
      $(this.profile.authorBreadcrumbVarious).first().text().trim() ||
      undefined;

    const genres: string[] = [];
    if (this.profile.genreSelector) {
      $(this.profile.genreSelector).each((_, el) => {
        const g = $(el).text().trim();
        if (g) genres.push(g);
      });
    }

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
        synopsis: decoded.replace(/^\/+/, ""),
        contentRating: this.contentRating,
        status: "Completed",
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const url = this.absoluteUrl(this.safeDecode(mangaId));
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    // Linked sub-albums act as chapters.
    $(this.profile.linkedChapterSelector).each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const chapterId = this.parseId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);
      const name = el.text().trim();
      chapters.push({
        chapterId,
        sourceManga,
        title: name || "Chapter",
        volume: 0,
        chapNum: chapters.length + 1,
        publishDate: new Date(0),
        langCode: this.langCode,
      });
    });

    // If the album itself shows page thumbnails, add it as a self chapter.
    if ($(this.profile.pageThumbnailSelector).first().length > 0) {
      const selfId = this.parseId(url);
      if (selfId && !seen.has(selfId)) {
        seen.add(selfId);
        chapters.push({
          chapterId: selfId,
          sourceManga,
          title: "Chapter",
          volume: 0,
          chapNum: chapters.length + 1,
          publishDate: new Date(0),
          langCode: this.langCode,
        });
      }
    }

    // Newest first, mirroring chapter list ordering.
    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const startUrl = this.absoluteUrl(this.safeDecode(chapter.chapterId));
    const pages: string[] = [];
    const fetchBudget = { count: 0 };
    await this.collectPages(startUrl, pages, fetchBudget);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  /**
   * Recursively gather full-size page images from an album, descending into
   * nested sub-albums and following pagination, matching the EroMuse base
   * class. Bounded by a fetch budget to keep things safe.
   */
  private async collectPages(
    url: string,
    pages: string[],
    budget: { count: number },
  ): Promise<void> {
    if (budget.count >= MAX_PAGE_FETCHES) return;
    budget.count++;

    const $ = await this.fetchCheerio({ url, method: "GET" });

    // Nested chapters (folders) are visited first.
    const nestedUrls: string[] = [];
    $(this.profile.linkedChapterSelector).each((_, element) => {
      const href = $(element).attr("href") || "";
      if (href) nestedUrls.push(this.absoluteUrl(href));
    });

    $(this.profile.pageThumbnailSelector).each((_, element) => {
      const raw = this.imageFromElement($(element));
      if (raw) {
        pages.push(raw.replace(this.profile.thumbSeg, this.profile.fullSeg));
      }
    });

    const next = this.nextPageUrl($, url);
    if (next) {
      await this.collectPages(next, pages, budget);
    }

    for (const nested of nestedUrls) {
      await this.collectPages(nested, pages, budget);
    }
  }

  getMangaShareUrl(mangaId: string): string {
    return this.absoluteUrl(this.safeDecode(mangaId));
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Recompute the next-page URL the way the EroMuse base class does: if the
   * current URL already has a page query parameter, bump it; otherwise append
   * the page number as a path segment (replacing a trailing numeric segment).
   */
  private nextPageUrl($: CheerioAPI, currentUrl: string): string | undefined {
    const text = $(NEXT_PAGE_SELECTOR).first().text().trim();
    const nextNum = parseInt(text, 10);
    if (!nextNum || isNaN(nextNum)) return undefined;

    if (/[?&]page=\d+/.test(currentUrl)) {
      return currentUrl.replace(/([?&]page=)\d+/, `$1${nextNum}`);
    }

    // Split off any query string.
    const [path, queryPart] = this.splitQuery(currentUrl);
    const segments = path.replace(/\/+$/, "").split("/");
    const last = segments[segments.length - 1];
    if (/^\d+$/.test(last)) {
      segments[segments.length - 1] = String(nextNum);
    } else {
      segments.push(String(nextNum));
    }
    const rebuilt = segments.join("/");
    return queryPart ? `${rebuilt}?${queryPart}` : rebuilt;
  }

  private splitQuery(url: string): [string, string] {
    const idx = url.indexOf("?");
    if (idx === -1) return [url, ""];
    return [url.slice(0, idx), url.slice(idx + 1)];
  }

  private parseId(href: string): string {
    let cleaned = href.replace(/#.*$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    cleaned = cleaned.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
    cleaned = cleaned.replace(/\/$/, "");
    return this.toSafeId(cleaned);
  }

  private absoluteUrl(idOrPath: string): string {
    if (/^https?:\/\//.test(idOrPath)) return idOrPath;
    const path = idOrPath.replace(/^\/+/, "");
    return `${this.baseUrl}/${path}`;
  }

  private titleFromId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const last = decoded.replace(/\/+$/, "").split("/").pop() ?? decoded;
    return last.replace(/[-_]+/g, " ").trim() || decoded;
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
