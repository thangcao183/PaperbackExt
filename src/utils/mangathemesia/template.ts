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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import {
  MangaThemesiaSearchForm,
  MangaThemesiaSearchMeta,
} from "./forms";
import {
  getBaseUrlOverride,
  MangaThemesiaSettingsForm,
} from "./settings";

export interface MangaThemesiaConfig {
  name: string;
  baseUrl: string;
  // The path prefix where manga live, defaults to "/manga".
  mangaUrlDirectory?: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface MangaThemesiaMetadata {
  page?: number;
  collectedIds?: string[];
  searchCollectedIds?: string[];
}

class MangaThemesiaInterceptor extends PaperbackInterceptor {
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

type MangaThemesiaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaThemesiaExtension implements MangaThemesiaImplementation {
  static readonly MAX_SEARCH_PAGES = 5;

  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly mangaUrlDirectory: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MangaThemesiaInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangaThemesiaConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    // mangaUrlDirectory is stored without leading/trailing slashes.
    this.mangaUrlDirectory = (config.mangaUrlDirectory ?? "/manga").replace(
      /^\/+|\/+$/g,
      "",
    );
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangaThemesiaInterceptor(
      "main",
      () => this.baseUrl,
    );
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaThemesiaSettingsForm(this.sourceName, this.defaultBaseUrl);
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

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: MangaThemesiaSearchMeta }
      | undefined;
    return new MangaThemesiaSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaThemesiaMetadata | undefined;
    switch (section.id) {
      case "popular_section":
        return this.getMangaListItems(meta, "popular", "featuredCarouselItem");
      case "latest_section":
        return this.getMangaListItems(meta, "update", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getMangaListItems(
    metadata: MangaThemesiaMetadata | undefined,
    order: string,
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    const url = new URLBuilder(this.baseUrl)
      .addPath(this.mangaUrlDirectory)
      .addQuery("title", "")
      .addQuery("page", page.toString())
      .addQuery("order", order)
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];

    $(this.searchMangaSelector).each((_, element) => {
      const unit = $(element);
      const link = unit.find("a").first();
      const href = link.attr("href") || "";
      const title = (link.attr("title") || link.text()).trim();
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

      if (title && mangaId && !collectedIds.includes(mangaId)) {
        collectedIds.push(mangaId);
        items.push({
          type: itemType,
          mangaId,
          imageUrl: image,
          title,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = $("div.pagination .next, div.hpage .r").length > 0;

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  get searchMangaSelector(): string {
    return ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx";
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return [
      { id: "", label: "Default" },
      { id: "title", label: "A-Z" },
      { id: "titlereverse", label: "Z-A" },
      { id: "update", label: "Latest Update" },
      { id: "latest", label: "Latest Added" },
      { id: "popular", label: "Popular" },
    ];
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaThemesiaMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.searchCollectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    const searchMeta = (
      query.metadata as { searchMeta?: MangaThemesiaSearchMeta } | undefined
    )?.searchMeta;

    const sortId = sortingOption?.id ?? "";
    const filterOrderBy =
      searchMeta?.orderBy && searchMeta.orderBy.length > 0
        ? searchMeta.orderBy[0]
        : "";
    const effectiveOrderBy = sortId || filterOrderBy;

    // MangaThemesia uses the SAME endpoint for search, popular, latest and
    // browse: {mangaUrlDirectory}/?title=&page=&order=&... so an empty query
    // simply lists everything.
    const builder = new URLBuilder(this.baseUrl)
      .addPath(this.mangaUrlDirectory)
      .addQuery("title", encodeURIComponent(titleQuery))
      .addQuery("page", page.toString());

    if (effectiveOrderBy) {
      builder.addQuery("order", effectiveOrderBy);
    }

    if (searchMeta) {
      if (searchMeta.author) {
        builder.addQuery("author", encodeURIComponent(searchMeta.author));
      }
      if (searchMeta.year) {
        builder.addQuery("yearx", encodeURIComponent(searchMeta.year));
      }
      if (searchMeta.status && searchMeta.status.length > 0) {
        builder.addQuery("status", searchMeta.status[0]);
      }
      if (searchMeta.type && searchMeta.type.length > 0) {
        builder.addQuery("type", searchMeta.type[0]);
      }
    }

    const url = builder.build();
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];

    $(this.searchMangaSelector).each((_, element) => {
      const unit = $(element);
      const link = unit.find("a").first();
      const href = link.attr("href") || "";
      const title = (link.attr("title") || link.text()).trim();
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

      if (title && mangaId && !collectedIds.includes(mangaId)) {
        collectedIds.push(mangaId);
        results.push({
          mangaId,
          imageUrl: image,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = $("div.pagination .next, div.hpage .r").length > 0;
    const reachedPageLimit = page >= MangaThemesiaExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit
          ? { page: page + 1, searchCollectedIds: collectedIds }
          : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.mangaUrlDirectory)
      .addPath(mangaId)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const details = $(
      "div.bigcontent, div.animefull, div.main-info, div.postbody",
    ).first();
    const scope = details.length > 0 ? details : $("html");

    const title = scope
      .find("h1.entry-title, .ts-breadcrumb li:last-child span")
      .first()
      .text()
      .trim();

    const image = this.imageFromElement(
      scope.find(".infomanga > div[itemprop=image] img, .thumb img").first(),
    );

    let description = "";
    scope
      .find(".desc, .entry-content[itemprop=description]")
      .each((_, el) => {
        const t = $(el).text().trim();
        if (t) description += (description ? "\n" : "") + t;
      });

    // Alt name appended to description (mirrors Kotlin behaviour).
    const altName = scope
      .find(
        ".alternative, .wd-full:contains(alt) span, .alter, .seriestualt",
      )
      .first()
      .text()
      .trim();
    const altTitles: string[] = [];
    if (altName) {
      altName.split(/[,;|]/).forEach((t) => {
        const trimmed = t.trim();
        if (trimmed) altTitles.push(trimmed);
      });
    }

    const authors: string[] = [];
    scope
      .find(
        ".infotable tr:contains(Author) td:last-child, .tsinfo .imptdt:contains(Author) i, .fmed b:contains(Author)+span",
      )
      .each((_, el) => {
        const a = $(el).text().trim();
        if (a && a !== "-" && a.toLowerCase() !== "n/a") authors.push(a);
      });

    const artists: string[] = [];
    scope
      .find(
        ".infotable tr:contains(Artist) td:last-child, .tsinfo .imptdt:contains(Artist) i, .fmed b:contains(Artist)+span",
      )
      .each((_, el) => {
        const a = $(el).text().trim();
        if (a && a !== "-" && a.toLowerCase() !== "n/a") artists.push(a);
      });

    const genres: string[] = [];
    scope
      .find("div.gnr a, .mgen a, .seriestugenre a")
      .each((_, el) => {
        const g = $(el).text().trim();
        if (g) genres.push(g);
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

    const statusText = scope
      .find(
        ".infotable tr:contains(Status) td:last-child, .tsinfo .imptdt:contains(Status) i, .fmed b:contains(Status)+span",
      )
      .first()
      .text()
      .trim();

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altTitles,
        thumbnailUrl: image,
        author: authors.join(", ") || undefined,
        artist: artists.join(", ") || undefined,
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
    const mangaId = sourceManga.mangaId;
    const mangaUrl = new URLBuilder(this.baseUrl)
      .addPath(this.mangaUrlDirectory)
      .addPath(mangaId)
      .build();

    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    const chapters: Chapter[] = [];

    $(
      "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)",
    ).each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterId = this.parseChapterId(href, mangaId);
      if (!chapterId) return;

      const chapterTitle =
        el.find(".lch a, .chapternum").text().trim() || link.text().trim();

      let chapNum = 0;
      const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const anyNum = chapterTitle.match(/(\d+(?:\.\d+)?)/);
        if (anyNum) chapNum = parseFloat(anyNum[1]);
      }

      const dateText = el.find(".chapterdate").text().trim();
      const publishDate = this.parseDate(dateText);

      chapters.push({
        chapterId,
        sourceManga,
        title: chapterTitle,
        volume: 0,
        chapNum,
        publishDate,
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.mangaUrlDirectory)
      .addPath(chapter.sourceManga.mangaId)
      .addPath(chapter.chapterId)
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    $("div#readerarea img").each((_, element) => {
      const image = this.imageFromElement($(element));
      if (image) pages.push(image);
    });

    // Fallback: some sites embed the image list as JSON in a script:
    // "images":[ ... ]
    if (pages.length === 0) {
      const html = $.root().html() || "";
      const match = html.match(/"images"\s*:\s*(\[.*?\])/s);
      if (match) {
        try {
          const arr = JSON.parse(match[1]) as unknown[];
          for (const entry of arr) {
            if (typeof entry === "string") {
              const u = entry.trim().replace(/\\\//g, "/");
              if (u) pages.push(u);
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return new URLBuilder(this.baseUrl)
      .addPath(this.mangaUrlDirectory)
      .addPath(mangaId)
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseMangaId(href: string): string {
    const marker = `/${this.mangaUrlDirectory}/`;
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    const idx = cleaned.indexOf(marker);
    if (idx !== -1) {
      return this.toSafeId(cleaned.slice(idx + marker.length).split("/")[0]);
    }
    return this.toSafeId(cleaned.split("/").pop() ?? "");
  }

  private parseChapterId(href: string, _mangaId: string): string {
    // MangaThemesia chapter URLs are flat: {baseUrl}/{chapter-slug}/
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    return this.toSafeId(cleaned.split("/").pop() ?? "");
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-lazy-src") ||
      img.attr("data-src") ||
      img.attr("data-cfsrc") ||
      "";

    if (!src) {
      const srcset = img.attr("srcset");
      if (srcset) {
        const candidates = srcset
          .split(",")
          .map((part) => part.trim().split(/\s+/))
          .map(([u, w]) => ({
            url: u,
            width: parseInt((w || "0").replace(/\D/g, "")) || 0,
          }));
        candidates.sort((a, b) => b.width - a.width);
        if (candidates.length > 0) src = candidates[0].url;
      }
    }

    if (!src) src = img.attr("src") || "";

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
    if (s.includes("complet") || s.includes("finished") || s.includes("tamat"))
      return "Completed";
    if (
      s.includes("ongoing") ||
      s.includes("on going") ||
      s.includes("publishing") ||
      s.includes("updating") ||
      s.includes("berjalan")
    )
      return "Ongoing";
    if (s.includes("hiatus") || s.includes("hold") || s.includes("pause"))
      return "Hiatus";
    if (s.includes("cancel") || s.includes("drop") || s.includes("discontin"))
      return "Cancelled";
    return "Unknown";
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;

    const now = new Date();
    const lower = dateText.toLowerCase();
    if (lower.includes("ago")) {
      const amount = parseInt(lower.match(/\d+/)?.[0] || "0");
      if (lower.includes("min")) return new Date(now.getTime() - amount * 60000);
      if (lower.includes("hour"))
        return new Date(now.getTime() - amount * 3600000);
      if (lower.includes("day"))
        return new Date(now.getTime() - amount * 86400000);
      if (lower.includes("week"))
        return new Date(now.getTime() - amount * 604800000);
      if (lower.includes("month"))
        return new Date(now.getTime() - amount * 2592000000);
      if (lower.includes("year"))
        return new Date(now.getTime() - amount * 31536000000);
    }
    return now;
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
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
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
