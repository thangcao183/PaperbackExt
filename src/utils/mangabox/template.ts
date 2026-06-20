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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, MangaBoxSettingsForm } from "./settings";

export interface MangaBoxConfig {
  name: string;
  baseUrl: string;
  mirrors?: string[];
  contentRating?: ContentRating;
  langCode?: string;
}

interface MangaBoxSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

interface MangaBoxApiChapter {
  chapter_name?: string;
  chapter_num?: number;
  chapter_slug?: string;
  updated_at?: string;
}

interface MangaBoxApiResponse {
  data?: {
    chapters?: MangaBoxApiChapter[];
    pagination?: { hasMore?: boolean };
  };
}

class MangaBoxInterceptor extends PaperbackInterceptor {
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

type MangaBoxImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaBoxExtension implements MangaBoxImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly mirrors: string[];
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MangaBoxInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangaBoxConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.mirrors = config.mirrors ?? [];
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangaBoxInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaBoxSettingsForm(
      this.sourceName,
      this.defaultBaseUrl,
      this.mirrors,
    );
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
        title: "Hot Manga",
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
    const listPath =
      section.id === "popular_section" ? "hot-manga" : "latest-manga";
    const url = new URLBuilder(this.baseUrl)
      .addPath("manga-list")
      .addPath(listPath)
      .addQuery("page", 1)
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    const itemType =
      section.id === "popular_section"
        ? "featuredCarouselItem"
        : "simpleCarouselItem";

    this.eachListItem($, (mangaId, title, image) => {
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

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaBoxSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery) {
      url = new URLBuilder(this.baseUrl)
        .addPath("search")
        .addPath("story")
        .addPath(this.normalizeSearchQuery(titleQuery))
        .addQuery("page", page)
        .build();
    } else {
      url = new URLBuilder(this.baseUrl)
        .addPath("manga-list")
        .addPath("hot-manga")
        .addQuery("page", page)
        .build();
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    this.eachListItem($, (mangaId, title, image) => {
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
      $(
        "div.group_page a:not([href]) + a:not(:contains(Last)), div.group-page a:not([href]) + a:not(:contains(Last)), a.page_select + a:not(.page_last), a.page-select + a:not(.page-last)",
      ).length > 0;
    const reachedLimit = page >= MangaBoxExtension.MAX_SEARCH_PAGES;

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

    const info = $("div.manga-info-top, div.panel-story-info").first();
    const title = info.find("h1, h2").first().text().trim();
    const image = this.imageFromElement(
      $("div.manga-info-pic img, span.info-image img").first(),
    );

    const author = info
      .find("li:contains(author) a, td:containsOwn(author) + td a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((s) => s.length > 0)
      .join(", ");

    const statusText = info
      .find("li:contains(status), td:containsOwn(status) + td")
      .first()
      .text()
      .trim();

    const genres: string[] = [];
    info
      .find(
        "div.manga-info-top li:contains(genres) a, td:containsOwn(genres) + td a",
      )
      .each((_, el) => {
        const g = $(el).text().trim();
        if (g) genres.push(g);
      });

    const description = $(
      "div#noidungm, div#panel-story-info-description, div#contentBox",
    )
      .first()
      .text()
      .trim();

    const altName = $(
      ".story-alternative, tr:has(.info-alternative) h2",
    )
      .first()
      .text()
      .replace(/alternative\s*:?/i, "")
      .trim();

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
        secondaryTitles: altName ? [altName] : [],
        thumbnailUrl: image,
        author: author || undefined,
        synopsis: description,
        contentRating: this.contentRating,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters (JSON API with pagination)
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.slugFromMangaId(sourceManga.mangaId);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    let guard = 0;

    while (hasMore && guard < 50) {
      guard++;
      const url = new URLBuilder(this.baseUrl)
        .addPath("api")
        .addPath("manga")
        .addPath(slug)
        .addPath("chapters")
        .addQuery("limit", limit)
        .addQuery("offset", offset)
        .build();

      let json: MangaBoxApiResponse;
      try {
        json = await this.fetchJson<MangaBoxApiResponse>({
          url,
          method: "GET",
        });
      } catch {
        break;
      }

      const list = json.data?.chapters ?? [];
      for (const c of list) {
        const chapterSlug = c.chapter_slug ?? "";
        if (!chapterSlug) continue;
        const chapterId = this.toSafeId(`manga/${slug}/${chapterSlug}`);
        if (seen.has(chapterId)) continue;
        seen.add(chapterId);

        const name = c.chapter_name ?? `Chapter ${c.chapter_num ?? 0}`;
        chapters.push({
          chapterId,
          sourceManga,
          title: name,
          volume: 0,
          chapNum: c.chapter_num ?? 0,
          publishDate: this.parseDate(c.updated_at),
          langCode: this.langCode,
        });
      }

      hasMore = json.data?.pagination?.hasMore === true && list.length > 0;
      offset += limit;
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.safeDecode(chapter.chapterId))
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    // Preferred: cdns=[...] and chapterImages=[...] in a script tag.
    $("script").each((_, el) => {
      const html = $(el).html() || "";
      if (!html.includes("cdns")) return;
      const cdnsMatch = html.match(/cdns\s*=\s*(\[[^\]]*\])/);
      const imagesMatch = html.match(/chapterImages\s*=\s*(\[[^\]]*\])/);
      if (!cdnsMatch || !imagesMatch) return;
      let cdns: string[] = [];
      let images: string[] = [];
      try {
        cdns = JSON.parse(cdnsMatch[1]);
        images = JSON.parse(imagesMatch[1]);
      } catch {
        return;
      }
      const cdn = cdns[0] || "";
      for (const img of images) {
        if (typeof img !== "string") continue;
        if (img.startsWith("http")) {
          pages.push(img);
        } else if (cdn) {
          pages.push(`${cdn}/${img}`);
        }
      }
    });

    // Fallback: plain image elements.
    if (pages.length === 0) {
      $("div.container-chapter-reader > img").each((_, el) => {
        const image = this.imageFromElement($(el));
        if (image) pages.push(image);
      });
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return new URLBuilder(this.baseUrl)
      .addPath(this.safeDecode(mangaId))
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, image: string) => void,
  ): void {
    $(
      "div.truyen-list > div.list-truyen-item-wrap, div.comic-list > .list-comic-item-wrap, .panel_story_list .story_item, div.list-truyen-item-wrap, div.list-comic-item-wrap",
    ).each((_, element) => {
      const unit = $(element);
      const link = unit.find("h3 a").first();
      const href =
        (link.attr("href") || unit.find("a").first().attr("href")) ?? "";
      const title = (link.text() || unit.find("a").first().attr("title") || "")
        .trim();
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());
      cb(mangaId, title, image);
    });
  }

  private normalizeSearchQuery(query: string): string {
    return query
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_|_$/g, "");
  }

  private slugFromMangaId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const parts = decoded.split("/").filter((p) => p.length > 0);
    return parts[parts.length - 1] ?? decoded;
  }

  private parseMangaId(href: string): string {
    let cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    cleaned = cleaned.replace(/^\/+/, "");
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

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    src = src.trim();
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
    if (s.includes("complet")) return "Completed";
    if (s.includes("ongoing") || s.includes("on going")) return "Ongoing";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
    return "Unknown";
  }

  private parseDate(dateText?: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
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

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}
