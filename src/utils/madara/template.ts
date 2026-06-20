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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";

export interface MadaraConfig {
  name: string;
  baseUrl: string;
  mangaSubString?: string;
  useNewChapterEndpoint?: boolean;
  contentRating?: ContentRating;
  langCode?: string;
}

interface MadaraMetadata {
  page?: number;
  collectedIds?: string[];
  searchCollectedIds?: string[];
}

class MadaraInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly baseUrl: string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${this.baseUrl}/`,
      origin: this.baseUrl,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
      "accept-encoding": "gzip, deflate, br",
      "cache-control": "no-cache",
      pragma: "no-cache",
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

type MadaraImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MadaraExtension implements MadaraImplementation {
  // Maximum number of pages to fetch when paginating search results.
  static readonly MAX_SEARCH_PAGES = 5;

  readonly baseUrl: string;
  readonly mangaSubString: string;
  readonly useNewChapterEndpoint: boolean;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  requestManager: MadaraInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MadaraConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.mangaSubString = config.mangaSubString ?? "manga";
    this.useNewChapterEndpoint = config.useNewChapterEndpoint ?? false;
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MadaraInterceptor("main", this.baseUrl);
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

  async getSearchFilters(): Promise<never[]> {
    return [];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MadaraMetadata | undefined;
    switch (section.id) {
      case "popular_section":
        return this.getMangaListItems(meta, "views", "featuredCarouselItem");
      case "latest_section":
        return this.getMangaListItems(meta, "latest", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getMangaListItems(
    metadata: MadaraMetadata | undefined,
    orderBy: "views" | "latest",
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    const builder = new URLBuilder(this.baseUrl).addPath(this.mangaSubString);
    if (page > 1) {
      builder.addPath("page").addPath(page.toString());
    }
    const url = builder.addQuery("m_orderby", orderBy).build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];

    $("div.page-item-detail, .manga__item").each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find("div.post-title a").first();
      const title = titleLink.text().trim();
      const href = titleLink.attr("href") || "";
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

    const hasNextPage =
      $("div.nav-previous, nav.navigation-ajax, a.nextpostslink").length > 0;

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MadaraMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.searchCollectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    // Madara search requires a query term. Without one the site returns
    // no usable results, so avoid pointlessly paging through empty pages.
    if (!titleQuery) {
      return { items: [], metadata: undefined };
    }

    const builder = new URLBuilder(this.baseUrl);
    if (page > 1) {
      builder.addPath("page").addPath(page.toString());
    }
    const url = builder
      .addQuery("s", encodeURIComponent(titleQuery))
      .addQuery("post_type", "wp-manga")
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];

    $("div.c-tabs-item__content, .manga__item").each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find("div.post-title a").first();
      const title = titleLink.text().trim();
      const href = titleLink.attr("href") || "";
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

    const hasNextPage =
      $("div.nav-previous, nav.navigation-ajax, a.nextpostslink").length > 0;

    // Cap search pagination so the app doesn't keep loading every page.
    const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;

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
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("div.post-title h3, div.post-title h1, #manga-title > h1")
      .first()
      .text()
      .trim();

    const altTitles: string[] = [];
    $("div.post-content_item:contains(Alternative) div.summary-content")
      .first()
      .text()
      .split(/[,;]/)
      .forEach((t) => {
        const trimmed = t.trim();
        if (trimmed) altTitles.push(trimmed);
      });

    const image = this.imageFromElement($("div.summary_image img").first());

    const description = $(
      "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt",
    )
      .first()
      .text()
      .trim();

    const authors: string[] = [];
    $("div.author-content > a, div.manga-authors > a").each((_, el) => {
      const a = $(el).text().trim();
      if (a) authors.push(a);
    });

    const artists: string[] = [];
    $("div.artist-content > a").each((_, el) => {
      const a = $(el).text().trim();
      if (a) artists.push(a);
    });

    let status = "Unknown";
    $("div.post-content_item, div.post-status div.summary-content").each(
      (_, el) => {
        const block = $(el);
        if (block.find("div.summary-heading").text().includes("Status")) {
          status = block.find("div.summary-content").text().trim() || status;
        }
      },
    );

    const genres: string[] = [];
    $("div.genres-content a").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const tagItems: string[] = [];
    $("div.tags-content a").each((_, el) => {
      const t = $(el).text().trim();
      if (t) tagItems.push(t);
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
    if (tagItems.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: tagItems.map((t) => ({
          id: t.toLowerCase().replace(/\s+/g, "-"),
          title: t,
        })),
      });
    }

    let rating = 0;
    const ratingValue = $("span#averagerate, span.score.total_votes")
      .first()
      .text()
      .trim();
    if (ratingValue) {
      const parsed = parseFloat(ratingValue);
      if (!isNaN(parsed)) rating = parsed / 5;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altTitles,
        thumbnailUrl: image,
        author: authors.join(", ") || undefined,
        artist: artists.join(", ") || undefined,
        synopsis: description,
        rating,
        contentRating: this.contentRating,
        status: this.parseStatus(status),
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
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();

    let $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    let chapterElements = $("li.wp-manga-chapter");

    // Madara frequently loads chapters via AJAX. Fall back to the
    // modern endpoint: POST {mangaUrl}/ajax/chapters
    if (chapterElements.length === 0) {
      try {
        const ajax = await this.fetchCheerio({
          url: `${mangaUrl}/ajax/chapters`,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            referer: `${mangaUrl}/`,
            "x-requested-with": "XMLHttpRequest",
          },
        });
        if (ajax("li.wp-manga-chapter").length > 0) {
          $ = ajax;
          chapterElements = ajax("li.wp-manga-chapter");
        }
      } catch {
        // ignore, fall through with whatever we have
      }
    }

    const chapters: Chapter[] = [];
    chapterElements.each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterTitle = link.text().trim();
      const chapterId = this.parseChapterId(href, mangaId);
      if (!chapterId) return;

      let chapNum = 0;
      const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const slugMatch = chapterId.match(/chapter-(\d+(?:[.-]\d+)?)/i);
        if (slugMatch) chapNum = parseFloat(slugMatch[1].replace("-", "."));
      }

      const dateText = el.find("span.chapter-release-date").text().trim();
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
      .addPath(this.mangaSubString)
      .addPath(chapter.sourceManga.mangaId)
      .addPath(chapter.chapterId)
      .addQuery("style", "list")
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    $(
      "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item)) img",
    ).each((_, element) => {
      const el = $(element);
      const img = el.is("img") ? el : el.find("img").first();
      const image = this.imageFromElement(img);
      if (image) pages.push(image);
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseMangaId(href: string): string {
    const match = href.match(
      new RegExp(`/${this.mangaSubString}/([^/]+)`),
    );
    if (match) return this.toSafeId(match[1]);
    // fallback: generic /<seg>/<slug>
    const generic = href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/");
    return this.toSafeId(generic.pop() ?? "");
  }

  private parseChapterId(href: string, mangaId: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    // mangaId may be percent-encoded; the raw href is not, so decode it
    // back when locating the manga segment within the chapter URL.
    const rawMangaId = this.safeDecode(mangaId);
    const marker = `/${this.mangaSubString}/${rawMangaId}/`;
    const idx = cleaned.indexOf(marker);
    if (idx !== -1) {
      return this.toSafeId(cleaned.slice(idx + marker.length));
    }
    return this.toSafeId(cleaned.split("/").pop() ?? "");
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
  // Slugs can contain decoded HTML entities such as apostrophes (from
  // `&#39;`), so percent-encode any disallowed character. The encoded ID
  // round-trips correctly when interpolated back into a request URL.
  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return (
        "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
      );
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
    let src = img.attr("data-src") || img.attr("data-lazy-src") || "";

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

    if (!src) src = img.attr("data-cfsrc") || "";
    if (!src) src = img.attr("data-manga-src") || "";
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
    if (s.includes("complet")) return "Completed";
    if (
      s.includes("ongoing") ||
      s.includes("on going") ||
      s.includes("publishing")
    )
      return "Ongoing";
    if (s.includes("hold") || s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
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
