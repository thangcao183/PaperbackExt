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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, MadThemeSettingsForm } from "./settings";
import {
  MadThemeSearchForm,
  MadThemeSearchMeta,
  ORDER_BY_OPTIONS,
} from "./forms";

export interface MadThemeConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface MadThemeSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

const MANGA_ID_REGEX = /\/manga\/(\d+)-/;

class MadThemeInterceptor extends PaperbackInterceptor {
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

type MadThemeImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MadThemeExtension implements MadThemeImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MadThemeInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MadThemeConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MadThemeInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new MadThemeSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        return this.getListItems("views", "featuredCarouselItem");
      case "latest_section":
        return this.getListItems("updated_at", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getListItems(
    sort: string,
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const url = new URLBuilder(this.baseUrl)
      .addPath("search")
      .addQuery("sort", sort)
      .addQuery("page", 1)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    $(".book-detailed-item").each((_, element) => {
      const unit = $(element);
      const link = unit.find("a").first();
      const href = link.attr("href") || "";
      const title = (link.attr("title") || link.text()).trim();
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

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
    const meta = (query.metadata as { searchMeta?: MadThemeSearchMeta })
      ?.searchMeta;
    return new MadThemeSearchForm(meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MadThemeSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const titleQuery = (query.title || "").trim();
    const searchMeta = (query.metadata as { searchMeta?: MadThemeSearchMeta })
      ?.searchMeta;

    const sortId = sortingOption?.id ?? "";
    const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
    const effectiveOrderBy = sortId || filterOrderBy;
    const status = searchMeta?.status?.[0] ?? "";

    const builder = new URLBuilder(this.baseUrl)
      .addPath("search")
      .addQuery("q", encodeURIComponent(titleQuery))
      .addQuery("page", page);
    if (effectiveOrderBy) builder.addQuery("sort", effectiveOrderBy);
    if (status) builder.addQuery("status", status);

    const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    $(".book-detailed-item").each((_, element) => {
      const unit = $(element);
      const link = unit.find("a").first();
      const href = link.attr("href") || "";
      const title = (link.attr("title") || link.text()).trim();
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

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
      $(".paginator > a.active + a:not([rel=next])").length > 0;
    const reachedLimit = page >= MadThemeExtension.MAX_SEARCH_PAGES;

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

    const title = $(".detail h1").first().text().trim();
    const image = this.imageFromElement($("#cover img").first());

    const altNames = $(".detail h2")
      .first()
      .text()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let description = $(".summary .content, .summary .content ~ p")
      .map((_, el) => $(el).text().trim())
      .get()
      .join("\n")
      .trim();
    if (altNames.length > 0) {
      description += `\n\nAlternative Names: ${altNames.join(", ")}`;
    }

    const author = $(".detail .meta > p > strong:contains(Authors) ~ a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((s) => s.length > 0)
      .join(", ");

    const statusText = $(".detail .meta > p > strong:contains(Status) ~ a")
      .first()
      .text()
      .trim();

    const genres: string[] = [];
    $(".detail .meta > p > strong:contains(Genres) ~ a").each((_, el) => {
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

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altNames,
        thumbnailUrl: image,
        author: author || undefined,
        synopsis: description.trim(),
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
    const mangaUrl = this.getMangaShareUrl(mangaId);
    const decoded = this.safeDecode(mangaId);
    const numericIdMatch = decoded.match(/(\d+)-/) || mangaUrl.match(MANGA_ID_REGEX);

    let $: CheerioAPI;
    if (numericIdMatch) {
      const numericId = numericIdMatch[1];
      const apiUrl = new URLBuilder(this.baseUrl)
        .addPath("api")
        .addPath("manga")
        .addPath(numericId)
        .addPath("chapters")
        .addQuery("source", "detail")
        .build();
      $ = await this.fetchCheerio({ url: apiUrl, method: "GET" });
    } else {
      $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $("#chapter-list > li").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parseChapterId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find(".chapter-title").first().text().trim();
      const dateText = el.find(".chapter-update").first().text().trim();

      let chapNum = 0;
      const numMatch = name.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const anyNum = name.match(/(\d+(?:\.\d+)?)/);
        if (anyNum) chapNum = parseFloat(anyNum[1]);
      }

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
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.safeDecode(chapter.chapterId))
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    $("#chapter-images img, .chapter-image[data-src]").each((_, element) => {
      const image = this.imageFromElement($(element));
      if (image) pages.push(image);
    });

    // Fallback: var chapImages='url1,url2';
    if (pages.length === 0) {
      $("script").each((_, el) => {
        const html = $(el).html() || "";
        const match = html.match(/var\s+chapImages\s*=\s*['"]([^'"]+)['"]/);
        if (match) {
          for (const part of match[1].split(",")) {
            const p = part.trim();
            if (p) pages.push(p.startsWith("http") ? p : `${this.baseUrl}/${p}`);
          }
        }
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
      .addPath("manga")
      .addPath(this.safeDecode(mangaId))
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseMangaId(href: string): string {
    const marker = "/manga/";
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    const idx = cleaned.indexOf(marker);
    if (idx !== -1) {
      return this.toSafeId(cleaned.slice(idx + marker.length).split("/")[0]);
    }
    return this.toSafeId(cleaned.split("/").pop() ?? "");
  }

  private parseChapterId(href: string): string {
    // Strip scheme + host so the stored ID is a site-relative path.
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

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
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
    if (s.includes("complet")) return "Completed";
    if (s.includes("ongoing") || s.includes("on going")) return "Ongoing";
    if (s.includes("hiatus") || s.includes("hold")) return "Hiatus";
    if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
    return "Unknown";
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const now = new Date();
    const lower = dateText.toLowerCase();
    if (lower.includes("ago")) {
      const amount = parseInt(lower.match(/\d+/)?.[0] || "0");
      if (lower.includes("sec")) return new Date(now.getTime() - amount * 1000);
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
      return now;
    }
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return now;
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
