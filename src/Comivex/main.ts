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
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { ComivexSearchForm, ComivexSearchMeta } from "./forms";
import { ComivexSettingsForm, getHideStale } from "./settings";

const BASE_URL = "https://comivex.com";

const SERIES_ID_REGEX = /\/series\/(\d+)[-/]/;
const RELATIVE_DATE_REGEX = /(\d+)\s+(year|month|week|day|hour|minute)s?/g;

// Pinned at the top of `sort_by=Updated` for months with no new chapters
// (upstream metadata-mtime bug). Numeric id is stable across slug renames.
const STALE_EXPLORE_IDS = new Set<string>([
  "7805",
  "8025",
  "8168",
  "8169",
  "8176",
  "8188",
]);

interface ComivexMetadata {
  page?: number;
}

class ComivexInterceptor extends PaperbackInterceptor {
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

type ComivexImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class ComivexExtension implements ComivexImplementation {
  requestManager = new ComivexInterceptor("main");
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

  async getSettingsForm(): Promise<Form> {
    return new ComivexSettingsForm();
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
      | { searchMeta?: ComivexSearchMeta }
      | undefined;
    return new ComivexSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as ComivexMetadata | undefined;
    const page = meta?.page ?? 1;

    if (section.id === "latest") {
      const $ = await this.fetchCheerio({
        url: `${BASE_URL}/latest/`,
        method: "GET",
      });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $("article.u-card").each((_, element) => {
        const card = $(element);
        const link = card.find("a.u-card__title").first();
        const href = link.attr("href") || "";
        const title = (link.attr("title") || link.text()).trim();
        if (!href || !title) return;
        const mangaId = this.parsePath(href);
        if (seen.has(mangaId)) return;
        seen.add(mangaId);
        items.push({
          type: "simpleCarouselItem",
          mangaId,
          imageUrl: this.absoluteUrl(
            card.find("img.u-card__img").first().attr("src") || "",
          ),
          title,
          metadata: undefined,
        });
      });
      return { items, metadata: undefined };
    }

    // popular -> explore sorted by Views
    const url = `${BASE_URL}/explore/?sort_by=Views&results=${page}&ajax=1`;
    const result = await this.exploreParse(url, "Views");
    return {
      items: result.items.map((r) => ({
        type: "featuredCarouselItem",
        mangaId: r.mangaId,
        imageUrl: r.imageUrl,
        title: r.title,
        metadata: undefined,
      })),
      metadata: result.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ComivexMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: ComivexSearchMeta } | undefined
    )?.searchMeta;

    const url = this.buildSearchUrl(titleQuery, searchMeta, page);
    const sort = searchMeta?.sort?.[0] || "Views";
    const result = await this.exploreParse(url, sort);

    return {
      items: result.items.map((r) => ({
        mangaId: r.mangaId,
        imageUrl: r.imageUrl,
        title: r.title,
        subtitle: undefined,
        metadata: undefined,
      })),
      metadata: result.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    titleQuery: string,
    searchMeta: ComivexSearchMeta | undefined,
    page: number,
  ): string {
    const params: string[] = [];
    if (titleQuery) params.push(`search=${encodeURIComponent(titleQuery)}`);

    // Site lists formats and content genres under one `genre_included`
    // param; Type wins when both are set.
    const type = searchMeta?.type?.[0] || "";
    const genre = searchMeta?.genre?.[0] || "";
    const genreIncluded = type || genre;
    params.push(`genre_included=${encodeURIComponent(genreIncluded)}`);
    params.push(`sort_by=${encodeURIComponent(searchMeta?.sort?.[0] || "Views")}`);
    params.push(`status=${encodeURIComponent(searchMeta?.status?.[0] || "")}`);
    params.push(`results=${page}`);
    params.push("ajax=1");

    return `${BASE_URL}/explore/?${params.join("&")}`;
  }

  private async exploreParse(
    url: string,
    sort: string,
  ): Promise<{
    items: { mangaId: string; title: string; imageUrl: string }[];
    hasNextPage: boolean;
  }> {
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const applyStaleFilter = getHideStale() && sort === "Updated";

    const items: { mangaId: string; title: string; imageUrl: string }[] = [];
    $("article.manga-card").each((_, element) => {
      const card = $(element);
      const link = card.find("a.card-cover").first();
      const href = link.attr("href") || "";
      if (!href) return;
      if (applyStaleFilter) {
        const idMatch = href.match(SERIES_ID_REGEX);
        if (idMatch && STALE_EXPLORE_IDS.has(idMatch[1])) return;
      }
      const title = card.find(".card-title a").first().text().trim();
      if (!title) return;
      items.push({
        mangaId: this.parsePath(href),
        title,
        imageUrl: this.absoluteUrl(card.find("img").first().attr("src") || ""),
      });
    });

    return { items, hasNextPage: items.length > 0 };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $(".md-title").first().text().trim() || this.safeDecode(mangaId);
    const author = $(".md-author span").first().text().trim();
    const synopsis = $("#synopsis").first().text().trim();
    const thumbnailUrl = this.absoluteUrl(
      $(".md-cover-wrap img.md-cover").first().attr("src") || "",
    );
    const statusText = $(".md-status").first().text().trim();

    const genres = $(".md-genres a.md-genre-pill")
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
    $(".ch-list .ch-item").each((_, element) => {
      const el = $(element);
      const link = el.find("a.ch-link").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const name = el.find(".ch-num").first().text().trim();
      const dateText = el.find(".ch-date").first().text().trim();

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate: this.parseRelativeDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("#chapter-images .page-wrapper img").each((_, element) => {
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

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
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
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    return "Unknown";
  }

  private parseRelativeDate(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    let matched = false;
    const now = new Date();
    const matches = dateStr.matchAll(RELATIVE_DATE_REGEX);
    for (const m of matches) {
      matched = true;
      const amount = parseInt(m[1], 10);
      switch (m[2]) {
        case "year":
          now.setFullYear(now.getFullYear() - amount);
          break;
        case "month":
          now.setMonth(now.getMonth() - amount);
          break;
        case "week":
          now.setDate(now.getDate() - amount * 7);
          break;
        case "day":
          now.setDate(now.getDate() - amount);
          break;
        case "hour":
          now.setHours(now.getHours() - amount);
          break;
        case "minute":
          now.setMinutes(now.getMinutes() - amount);
          break;
      }
    }
    return matched ? now : new Date(0);
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

export const Comivex = new ComivexExtension();
