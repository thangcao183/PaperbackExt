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
import { MangaDemonSearchForm, MangaDemonSearchMeta } from "./forms";

const BASE_URL = "https://demonicscans.org";

// Paperback requires a non-empty thumbnailUrl/imageUrl; some manga have no
// cover, so fall back to a self-contained placeholder that can never 404.
const PLACEHOLDER_COVER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDUwIiB2aWV3Qm94PSIwIDAgMzAwIDQ1MCI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0NTAiIGZpbGw9IiMyMzI4MmYiLz48dGV4dCB4PSIxNTAiIHk9IjIyNSIgZmlsbD0iIzhhOTBhMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPk5vIENvdmVyPC90ZXh0Pjwvc3ZnPg==";


interface MangaDemonMetadata {
  page?: number;
}

class MangaDemonInterceptor extends PaperbackInterceptor {
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

type MangaDemonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaDemonExtension implements MangaDemonImplementation {
  requestManager = new MangaDemonInterceptor("main");
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
      | { searchMeta?: MangaDemonSearchMeta }
      | undefined;
    return new MangaDemonSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaDemonMetadata | undefined;
    const page = meta?.page ?? 1;

    const items: DiscoverSectionItem[] = [];

    if (section.id === "popular") {
      const url = `${BASE_URL}/advanced.php?list=${page}&status=all&orderby=VIEWS%20DESC`;
      const $ = await this.fetchCheerio({ url, method: "GET" });
      $("div#advanced-content > div.advanced-element").each((_, element) => {
        const el = $(element);
        const parsed = this.parseAdvancedItem($, el);
        if (!parsed) return;
        items.push({
          type: "featuredCarouselItem",
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          metadata: undefined,
        });
      });
      const hasNextPage =
        this.hasNextPage($);
      return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }

    const url = `${BASE_URL}/lastupdates.php?list=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });
    $("div#updates-container > div.updates-element").each((_, element) => {
      const el = $(element);
      // Skip premium/locked entries (marked with a toffee badge). `:has()`
      // is unsupported by Paperback's CSS engine, so check in JS.
      if (el.find(".toffee-badge").length > 0) return;
      const info = el.find("div.updates-element-info").first();
      const link = info.find("a").first();
      const href = link.attr("href") || "";
      const title = link.text().trim();
      if (!href || !title) return;
      const imageUrl =
        this.absoluteUrl(el.find("div.thumb img").first().attr("src") || "") ||
        PLACEHOLDER_COVER;
      items.push({
        type: "simpleCarouselItem",
        mangaId: this.parsePath(href),
        imageUrl,
        title,
        metadata: undefined,
      });
    });
    const hasNextPage =
      this.hasNextPage($);
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaDemonMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangaDemonSearchMeta } | undefined
    )?.searchMeta;

    // Text search uses search.php and returns a single page.
    if (titleQuery) {
      const url = `${BASE_URL}/search.php?manga=${encodeURIComponent(
        titleQuery,
      )}`;
      const $ = await this.fetchCheerio({ url, method: "GET" });
      const results: SearchResultItem[] = [];
      $("body > a[href]").each((_, element) => {
        const el = $(element);
        const href = el.attr("href") || "";
        const title = el.find("div.seach-right > div").first().text().trim();
        if (!href || !title) return;
        const imageUrl =
          this.absoluteUrl(el.find("img").first().attr("src") || "") ||
          PLACEHOLDER_COVER;
        results.push({
          mangaId: this.parsePath(href),
          imageUrl,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      });
      return { items: results, metadata: undefined };
    }

    // Empty query -> advanced.php filter browse (parsed like popular).
    const url = this.buildFilterUrl(searchMeta, page);
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    $("div#advanced-content > div.advanced-element").each((_, element) => {
      const el = $(element);
      const parsed = this.parseAdvancedItem($, el);
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });
    const hasNextPage =
      this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildFilterUrl(
    searchMeta: MangaDemonSearchMeta | undefined,
    page: number,
  ): string {
    const params: string[] = [`list=${page}`];

    for (const genre of searchMeta?.genres ?? []) {
      params.push(`genre[]=${encodeURIComponent(genre)}`);
    }

    const status = searchMeta?.status?.[0] ?? "all";
    params.push(`status=${encodeURIComponent(status)}`);

    const sort = searchMeta?.sort?.[0] ?? "VIEWS DESC";
    params.push(`orderby=${encodeURIComponent(sort)}`);

    return `${BASE_URL}/advanced.php?${params.join("&")}`;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const container = $("div#manga-info-container").first();
    const title =
      container.find("h1.big-fat-titles").first().text().trim() ||
      this.safeDecode(mangaId);
    const coverImg = container.find("div#manga-page img").first();
    const rawCover =
      coverImg.attr("src") ||
      coverImg.attr("data-src") ||
      coverImg.attr("data-lazy-src") ||
      "";
    const thumbnailUrl = this.absoluteUrl(rawCover) || PLACEHOLDER_COVER;
    const synopsis = container
      .find("div#manga-info-rightColumn > div > div.white-font")
      .first()
      .text()
      .trim();
    // The stats block is a set of `div`s, each containing two `li`s:
    // `<li>Label</li><li>Value</li>`. jQuery-style `:eq()`/`:contains()`
    // pseudo-classes are NOT supported by Paperback's CSS engine (throws
    // "Unknown pseudo-class :eq"), so match the label in JS and read the
    // sibling value instead.
    const statValue = (label: string): string => {
      let value = "";
      container.find("div#manga-info-stats > div").each((_, el) => {
        if (value) return;
        const lis = $(el).find("> li");
        if (lis.length < 2) return;
        const key = lis.eq(0).text().trim();
        if (key.toLowerCase().includes(label.toLowerCase())) {
          value = lis.eq(1).text().trim();
        }
      });
      return value;
    };
    const author = statValue("Author");
    const statusText = statValue("Status");

    const genres = container
      .find("div.genres-list > li")
      .map((_, el) => $(el).text().trim())
      .get()
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
        thumbnailUrl,
        author: author || undefined,
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

    const chapters: Chapter[] = [];
    $("div#chapters-list a.chplinks").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      // ownText: the link text excluding the nested <span> date.
      const name = el.clone().children().remove().end().text().trim();
      const dateText = el.find("span").first().text().trim();

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div > img.imgholder").each((_, element) => {
      const src = $(element).attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });

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

  private parseAdvancedItem(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; title: string; imageUrl: string } | undefined {
    const link = el.find("a").first();
    const href = link.attr("href") || "";
    const title = el.find("h1").first().text().trim();
    if (!href || !title) return undefined;
    const imageUrl =
      this.absoluteUrl(el.find("img").first().attr("src") || "") ||
      PLACEHOLDER_COVER;
    return { mangaId: this.parsePath(href), title, imageUrl };
  }

  private mangaUrl(mangaId: string): string {
    const slug = mangaId;
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  // Paperback's CSS engine rejects jQuery pseudo-classes like `:contains()`,
  // so detect the "Next" pagination link by iterating in JS instead.
  private hasNextPage($: CheerioAPI): boolean {
    let found = false;
    $("div.pagination > ul > a > li").each((_, el) => {
      if (found) return;
      if ($(el).text().trim().toLowerCase().includes("next")) found = true;
    });
    return found;
  }

  private chapterUrl(chapterId: string): string {
    const slug = chapterId;
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    // The site emits hrefs whose slugs are already percent-encoded (often
    // multiply, e.g. `12%25252Dcenti`). The page only resolves with that
    // EXACT literal, so preserve it verbatim - decoding/re-encoding here
    // corrupts such slugs and yields a 404 (empty details + chapters).
    const cleaned = href.replace(/#.*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return slug;
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

  private parseChapterNumber(name: string): number {
    const match = name.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : -1;
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
    // Format yyyy-MM-dd
    const m = dateText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d.getTime())) return d;
    }
    const fallback = new Date(dateText);
    return isNaN(fallback.getTime()) ? new Date(0) : fallback;
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

export const MangaDemon = new MangaDemonExtension();
