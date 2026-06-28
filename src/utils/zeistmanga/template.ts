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
import { getBaseUrlOverride, ZeistMangaSettingsForm } from "./settings";

const PLACEHOLDER_COVER =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAi" +
  "IGhlaWdodD0iNDUwIiB2aWV3Qm94PSIwIDAgMzAwIDQ1MCI+PHJlY3Qgd2lkdGg9IjMw" +
  "MCIgaGVpZ2h0PSI0NTAiIGZpbGw9IiMyMzI4MmYiLz48dGV4dCB4PSIxNTAiIHk9IjIy" +
  "NSIgZmlsbD0iIzhhOTNhMyIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6" +
  "ZT0iMjQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRk" +
  "bGUiPk5vIENvdmVyPC90ZXh0Pjwvc3ZnPg==";

export interface ZeistMangaConfig {
  name: string;
  baseUrl: string;
  contentRating?: ContentRating;
  langCode?: string;
  // Categories used in the Blogger feed.
  mangaCategory?: string;
  chapterCategory?: string;
  // HTML selectors (defaults match the MurimScan override set).
  popularMangaSelector?: string;
  popularMangaSelectorTitle?: string;
  mangaDetailsSelector?: string;
  mangaDetailsSelectorGenres?: string;
  mangaDetailsSelectorInfo?: string;
  mangaDetailsSelectorInfoTitle?: string;
  mangaDetailsSelectorInfoDescription?: string;
  pageListSelector?: string;
}

interface ZeistSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

interface ZeistEntry {
  title?: { $t?: string };
  published?: { $t?: string };
  updated?: { $t?: string };
  category?: { term?: string }[];
  link?: { rel?: string; href?: string }[];
  content?: { $t?: string };
  "media$thumbnail"?: { url?: string };
}

interface ZeistFeedResponse {
  feed?: {
    "openSearch$totalResults"?: { $t?: string };
    entry?: ZeistEntry[];
  };
  "openSearch$totalResults"?: { $t?: string };
}

const MAX_MANGA_RESULTS = 20;

class ZeistMangaInterceptor extends PaperbackInterceptor {
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

type ZeistMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class ZeistMangaExtension implements ZeistMangaImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  readonly mangaCategory: string;
  readonly chapterCategory: string;
  readonly popularMangaSelector: string;
  readonly popularMangaSelectorTitle: string;
  readonly mangaDetailsSelector: string;
  readonly mangaDetailsSelectorGenres: string;
  readonly mangaDetailsSelectorInfo: string;
  readonly mangaDetailsSelectorInfoTitle: string;
  readonly mangaDetailsSelectorInfoDescription: string;
  readonly pageListSelector: string;

  static readonly MAX_SEARCH_PAGES = 5;

  private static readonly STATUS_ONGOING = ["ongoing", "en curso", "ativo"];
  private static readonly STATUS_COMPLETED = ["completed", "completo", "finalizado"];
  private static readonly STATUS_HIATUS = ["hiatus", "pausado"];
  private static readonly STATUS_CANCELLED = [
    "cancelled",
    "dropped",
    "dropado",
    "cancelado",
  ];

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: ZeistMangaInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: ZeistMangaConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";

    this.mangaCategory = config.mangaCategory ?? "Series";
    this.chapterCategory = config.chapterCategory ?? "Chapter";
    this.popularMangaSelector =
      config.popularMangaSelector ?? "div.PopularPosts div.grid > figure";
    this.popularMangaSelectorTitle =
      config.popularMangaSelectorTitle ?? "figcaption > a";
    this.mangaDetailsSelector =
      config.mangaDetailsSelector ?? ".grid.gtc-235fr";
    this.mangaDetailsSelectorGenres =
      config.mangaDetailsSelectorGenres ?? "div.mt-15 > a[rel=tag]";
    this.mangaDetailsSelectorInfo =
      config.mangaDetailsSelectorInfo ?? ".y6x11p";
    this.mangaDetailsSelectorInfoTitle =
      config.mangaDetailsSelectorInfoTitle ?? "strong";
    this.mangaDetailsSelectorInfoDescription =
      config.mangaDetailsSelectorInfoDescription ?? "span.dt";
    this.pageListSelector =
      config.pageListSelector ?? "div.check-box div.separator";

    this.requestManager = new ZeistMangaInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new ZeistMangaSettingsForm(this.sourceName, this.defaultBaseUrl);
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
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "popular_section") {
      const $ = await this.fetchCheerio({ url: this.baseUrl, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $(this.popularMangaSelector).each((_, element) => {
        const el = $(element);
        const link = el.find(this.popularMangaSelectorTitle).first();
        const href = (link.attr("href") || "").split("?")[0];
        const title = link.text().trim();
        const mangaId = this.parsePath(href);
        const image = this.imageFromElement(el.find("img").first());
        if (title && mangaId && !seen.has(mangaId)) {
          seen.add(mangaId);
          items.push({
            type: "featuredCarouselItem",
            mangaId,
            imageUrl: image || PLACEHOLDER_COVER,
            title,
            metadata: undefined,
          });
        }
      });

      // Some Blogger/Zeist themes render the popular carousel client-side
      // (e.g. a BloggerRandom slider), so the static HTML yields nothing.
      // Fall back to the manga-category feed in that case.
      if (items.length === 0) {
        const feedUrl =
          `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(
            this.mangaCategory,
          )}?alt=json&orderby=published&max-results=${MAX_MANGA_RESULTS}`;
        const { items: feedItems } = await this.parseFeedList(feedUrl);
        for (const m of feedItems) {
          if (seen.has(m.mangaId)) continue;
          seen.add(m.mangaId);
          items.push({
            type: "featuredCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
          });
        }
      }

      return { items, metadata: undefined };
    }

    // Latest -> Blogger feed, paginated.
    const meta = metadata as ZeistSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const startIndex = MAX_MANGA_RESULTS * (page - 1) + 1;
    const url =
      `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(
        this.mangaCategory,
      )}?alt=json&orderby=published` +
      `&max-results=${MAX_MANGA_RESULTS + 1}&start-index=${startIndex}`;

    const { items, hasNextPage } = await this.parseFeedList(url);
    const results: DiscoverSectionItem[] = items.map((m) => ({
      type: "simpleCarouselItem",
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));

    const reachedLimit = page >= ZeistMangaExtension.MAX_SEARCH_PAGES;
    return {
      items: results,
      metadata:
        hasNextPage && !reachedLimit ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ZeistSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];
    const startIndex = MAX_MANGA_RESULTS * (page - 1) + 1;

    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery) {
      url =
        `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(
          this.mangaCategory,
        )}?alt=json` +
        `&max-results=${MAX_MANGA_RESULTS + 1}&start-index=${startIndex}` +
        `&q=label:${encodeURIComponent(this.mangaCategory)}+${encodeURIComponent(
          titleQuery,
        )}`;
    } else {
      url =
        `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(
          this.mangaCategory,
        )}?alt=json&orderby=published` +
        `&max-results=${MAX_MANGA_RESULTS + 1}&start-index=${startIndex}`;
    }

    const { items, hasNextPage } = await this.parseFeedList(url);
    const seen = new Set<string>(collectedIds);
    const results: SearchResultItem[] = [];
    for (const m of items) {
      if (seen.has(m.mangaId)) continue;
      seen.add(m.mangaId);
      results.push({
        mangaId: m.mangaId,
        imageUrl: m.imageUrl,
        title: m.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const reachedLimit = page >= ZeistMangaExtension.MAX_SEARCH_PAGES;
    return {
      items: results,
      metadata:
        hasNextPage && !reachedLimit
          ? { page: page + 1, collectedIds: [...seen] }
          : undefined,
    };
  }

  private async parseFeedList(
    url: string,
  ): Promise<{
    items: { mangaId: string; title: string; imageUrl: string }[];
    hasNextPage: boolean;
  }> {
    const json = await this.fetchJson<ZeistFeedResponse>({
      url,
      method: "GET",
    });
    const entries = json.feed?.entry ?? [];
    const filtered = entries.filter(
      (e) =>
        (e.category ?? []).some((c) => c.term === this.mangaCategory) &&
        !(e.category ?? []).some((c) => c.term === "Anime"),
    );

    const items = filtered.map((e) => this.entryToManga(e));
    let hasNextPage = false;
    if (items.length === MAX_MANGA_RESULTS + 1) {
      items.pop();
      hasNextPage = true;
    }
    return { items, hasNextPage };
  }

  private entryToManga(entry: ZeistEntry): {
    mangaId: string;
    title: string;
    imageUrl: string;
  } {
    const title = entry.title?.$t ?? "";
    const alternate = (entry.link ?? []).find((l) => l.rel === "alternate");
    const href = alternate?.href ?? "";
    const mangaId = this.parsePath(href);

    let imageUrl = "";
    const thumb = entry["media$thumbnail"]?.url;
    if (thumb) {
      imageUrl = thumb
        .replace(/\/s.+?-c\//, "/w600/")
        .replace(/=s(?!.*=s).+?-c$/, "=w600");
    } else if (entry.content?.$t) {
      const $c = cheerio.load(htmlparser2.parseDocument(entry.content.$t));
      imageUrl = $c("img").first().attr("src") ?? "";
    }

    return { mangaId, title, imageUrl: imageUrl || PLACEHOLDER_COVER };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const profile = $(this.mangaDetailsSelector).first();
    const scope = profile.length > 0 ? profile : $("body");

    // og:title often carries a " - Site Name" suffix; #chapterlist[data-label]
    // holds the exact bare series title when present.
    const dataLabel = ($("#chapterlist").attr("data-label") || "").trim();
    const title =
      dataLabel ||
      ($("meta[property='og:title']").attr("content") || "").trim();
    const image = this.imageFromElement(scope.find("img").first());

    let description = scope.find("#synopsis").text().trim();
    const altName = scope.find("header > p").first().text().trim();
    if (altName) {
      description = `${description}\n\nAlternative name(s): ${altName}`.trim();
    }

    const genres: string[] = [];
    scope.find(this.mangaDetailsSelectorGenres).each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    let author: string | undefined;
    let artist: string | undefined;
    let status = "Unknown";

    scope.find(this.mangaDetailsSelectorInfo).each((_, el) => {
      const element = $(el);
      let infoText = element
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim();
      if (!infoText) {
        infoText = element
          .find(this.mangaDetailsSelectorInfoTitle)
          .first()
          .text()
          .trim();
      }
      const descText = element
        .find(this.mangaDetailsSelectorInfoDescription)
        .text()
        .trim();
      const lower = infoText.toLowerCase();
      if (lower.includes("status")) {
        status = this.parseStatus(descText);
      } else if (lower.includes("author")) {
        author = descText || author;
      } else if (lower.includes("artist")) {
        artist = descText || artist;
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
        secondaryTitles: [],
        thumbnailUrl: image || PLACEHOLDER_COVER,
        author,
        artist,
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
    const mangaUrl = this.getMangaShareUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    const feedUrl = this.getChapterFeedUrl($);
    const json = await this.fetchJson<ZeistFeedResponse>({
      url: feedUrl,
      method: "GET",
    });

    const entries = (json.feed?.entry ?? []).filter(
      (e) =>
        !(e.category ?? []).some(
          (c) => c.term?.toLowerCase() === this.mangaCategory.toLowerCase(),
        ),
    );

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    entries.forEach((entry, index) => {
      const alternate = (entry.link ?? []).find((l) => l.rel === "alternate");
      const href = alternate?.href ?? "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = entry.title?.$t?.trim() ?? "";

      let publishDate = new Date(0);
      const dateStr = entry.published?.$t || entry.updated?.$t;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) publishDate = parsed;
      }

      let chapNum = -1;
      const numMatch = name.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        chapNum = entries.length - index;
      }

      chapters.push({
        chapterId,
        sourceManga,
        title: name || `Chapter ${chapNum}`,
        volume: 0,
        chapNum,
        publishDate,
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  private getChapterFeedUrl($: CheerioAPI): string {
    // Preferred: the site's own chapter-loader reads the bare series title
    // from #chapterlist[data-label] and queries the title-only feed. The
    // og:title meta often carries a " - Site Name" suffix that breaks the
    // feed match, so data-label is the reliable source.
    const dataLabel = $("#chapterlist").attr("data-label");
    const label = (dataLabel ?? "").replace(/[',]/g, "").trim();
    if (label) {
      return (
        `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(label)}` +
        `?alt=json&max-results=999999`
      );
    }

    // Fallback: scan inline scripts for a feed label.
    let feed = "";
    $("script").each((_, el) => {
      if (feed) return;
      const data = $(el).contents().text();
      const m =
        data.match(/clwd\.run\(["']([^"']+)["']\)/) ||
        data.match(/label\s*=\s*'([^']+)'/);
      if (m) feed = m[1].replace(/[',]/g, "").trim();
    });
    if (feed) {
      return (
        `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(feed)}` +
        `?alt=json&start-index=1&max-results=999999`
      );
    }

    // Last resort: derive the bare title from og:title (strip any
    // " - Site Name" suffix) and query the title-only feed.
    const ogTitle = ($("meta[property='og:title']").attr("content") ?? "")
      .replace(/\s*-\s*[^-]+\s*$/, "")
      .replace(/[',]/g, "")
      .trim();
    if (ogTitle) {
      return (
        `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(ogTitle)}` +
        `?alt=json&max-results=999999`
      );
    }

    return (
      `${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(
        this.chapterCategory,
      )}` + `?alt=json&max-results=999999`
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.getMangaShareUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url: chapterUrl, method: "GET" });

    const pages: string[] = [];
    $(this.pageListSelector)
      .find("img[src]")
      .each((_, img) => {
        const src = this.imageFromElement($(img));
        if (src) pages.push(src);
      });

    const uniquePages = [...new Set(pages)];

    // Returning an empty page list hard-crashes the Paperback reader. Paid /
    // login-gated chapters render no images server-side, so throw a clear
    // error instead.
    if (uniquePages.length === 0) {
      throw new Error(
        "No pages found — this chapter may be paid or require logging in.",
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: uniquePages,
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
    let cleaned = href.replace(/#.*$/, "");
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
    if (ZeistMangaExtension.STATUS_ONGOING.some((x) => s.includes(x)))
      return "Ongoing";
    if (ZeistMangaExtension.STATUS_COMPLETED.some((x) => s.includes(x)))
      return "Completed";
    if (ZeistMangaExtension.STATUS_HIATUS.some((x) => s.includes(x)))
      return "Hiatus";
    if (ZeistMangaExtension.STATUS_CANCELLED.some((x) => s.includes(x)))
      return "Cancelled";
    return "Unknown";
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}
