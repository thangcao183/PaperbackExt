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
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://rinkocomics.com";

const CHAPTER_SELECTOR = "li.chapter";
const CHAPTERS_PER_PAGE = 10;
const LOCK_PREFIX = "🔒 ";
const LOCK_SUFFIX = "#lock";
const NONCE_REGEX =
  /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/;

interface RinkoComicsMetadata {
  page?: number;
  genre?: string;
}

const SORT_NEWEST = "newest";

class RinkoComicsInterceptor extends PaperbackInterceptor {
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

type RinkoComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class RinkoComicsExtension implements RinkoComicsImplementation {
  requestManager = new RinkoComicsInterceptor("main");
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
        title: "Pinned Comics",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "genres",
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "popular") {
      return this.getPopularSection();
    }
    if (section.id === "genres") {
      return this.getGenresSection();
    }
    return this.getLatestSection(metadata);
  }

  private async getPopularSection(): Promise<
    PagedResults<DiscoverSectionItem>
  > {
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".comics-flex-pinned a.pinned-comic-card").each((_, element) => {
      const el = $(element);
      const href = (el.attr("href") || "").trim();
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      const title = el.find(".pinned-comic-title").first().text().trim();
      if (!title) return;
      seen.add(mangaId);
      const imageUrl = this.imageFromElement(
        el.find(".comic-thumbnail img").first(),
      );
      items.push({
        type: "featuredCarouselItem",
        mangaId,
        imageUrl,
        title,
        metadata: undefined,
      });
    });

    return { items, metadata: undefined };
  }

  private async getLatestSection(
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as RinkoComicsMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = `${this.comicsUrl(page)}?sort=${SORT_NEWEST}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    this.parseComicCards($).forEach((entry) => {
      if (seen.has(entry.mangaId)) return;
      seen.add(entry.mangaId);
      items.push({
        type: "simpleCarouselItem",
        mangaId: entry.mangaId,
        imageUrl: entry.imageUrl,
        title: entry.title,
        metadata: undefined,
      });
    });

    const hasNextPage = $(".ac-pagination a.next").length > 0;
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async getGenresSection(): Promise<
    PagedResults<DiscoverSectionItem>
  > {
    const $ = await this.fetchCheerio({
      url: `${this.comicsUrl(1)}`,
      method: "GET",
    });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".ac-filter-group.ac-genre input[name='genres[]']").each(
      (_, element) => {
        const input = $(element);
        const slug = (input.attr("value") || "").trim();
        const name = input
          .parent()
          .find(".ac-option-text")
          .first()
          .text()
          .trim();
        if (!slug || !name || seen.has(slug)) return;
        seen.add(slug);
        items.push({
          type: "genresCarouselItem",
          name,
          searchQuery: {
            title: "",
            metadata: { genre: slug },
          },
          metadata: { genre: slug },
        });
      },
    );

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as RinkoComicsMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as RinkoComicsMetadata | undefined;
    const genre = meta?.genre ?? queryMeta?.genre;

    const params: string[] = [];
    params.push("post_type=comic");
    if (titleQuery) params.push(`s=${encodeURIComponent(titleQuery)}`);
    if (genre) params.push(`genres[]=${encodeURIComponent(genre)}`);

    const url = `${this.comicsUrl(page)}?${params.join("&")}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    this.parseComicCards($).forEach((entry) => {
      results.push({
        mangaId: entry.mangaId,
        imageUrl: entry.imageUrl,
        title: entry.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $(".ac-pagination a.next").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1, genre } : undefined,
    };
  }

  private parseComicCards(
    $: CheerioAPI,
  ): { mangaId: string; imageUrl: string; title: string }[] {
    const entries: { mangaId: string; imageUrl: string; title: string }[] = [];
    $("article.ac-card").each((_, element) => {
      const card = $(element);
      const link = card.find(".ac-title a").first();
      const href = (link.attr("href") || "").trim();
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId) return;
      const title = link.text().trim();
      if (!title) return;
      const imageUrl = this.imageFromElement(card.find(".ac-thumb img").first());
      entries.push({ mangaId, imageUrl, title });
    });
    return entries;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $(".comic-info-upper h1").first().text().trim() ||
      $("h1").first().text().trim() ||
      this.safeDecode(mangaId);

    const thumbnailUrl = this.absoluteUrl(
      $("meta[property=og:image]").first().attr("content") || "",
    );

    const authors: string[] = [];
    $(".comic-graph > span").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text !== "•" && !authors.includes(text)) authors.push(text);
    });

    const statusText = $(".comic-status span:last-child").first().text();

    const genres: string[] = [];
    $(".comic-genres .genres .genre").each((_, el) => {
      const text = $(el).text().trim();
      if (text) genres.push(text);
    });

    const synopsis = $(".comic-synopsis").first().text().trim();

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
        author: authors[0],
        artist: authors[1],
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

    const chapters = new Map<string, Chapter>();
    const addAll = (items: Chapter[]) => {
      for (const chapter of items) {
        if (!chapters.has(chapter.chapterId)) {
          chapters.set(chapter.chapterId, chapter);
        }
      }
    };

    addAll(this.parseChapterElements($, $(CHAPTER_SELECTOR), sourceManga));

    const loadMoreBtn = $("#loadMoreChaptersBtn").first();
    const comicId = (loadMoreBtn.attr("data-comic-id") || "").trim();
    const nonce = this.extractNonce($) || "";
    let offset = parseInt(loadMoreBtn.attr("data-offset") || "", 10);
    if (isNaN(offset) || offset <= 0) {
      offset = chapters.size;
    } else if (chapters.size > 0 && offset > chapters.size) {
      offset = chapters.size;
    }

    if (comicId && nonce) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const items = await this.fetchMoreChapters(
          comicId,
          offset,
          nonce,
          sourceManga,
        );
        if (items.length === 0) break;
        const before = chapters.size;
        addAll(items);
        offset += CHAPTERS_PER_PAGE;
        if (chapters.size === before) break;
      }
    }

    const list = Array.from(chapters.values());
    return list.map((chapter, index) => ({
      ...chapter,
      chapNum: chapter.chapNum || list.length - index,
    }));
  }

  private parseChapterElements(
    $: CheerioAPI,
    elements: Cheerio<AnyNode>,
    sourceManga: SourceManga,
  ): Chapter[] {
    const chapters: Chapter[] = [];
    elements.each((_, element) => {
      const el = $(element);
      const permalink = (el.attr("data-permalink") || "").trim();
      const href = el.find("a").first().attr("href") || "";
      const rawUrl = permalink || href;
      if (!rawUrl) return;

      let name =
        el.find(".chapter-number").first().text().trim() ||
        (el.attr("data-title") || "").trim();
      const dateText = el.find(".chapter-date").first().text().trim();
      const locked = this.isLocked($, el);

      let chapterId = this.parsePath(rawUrl);
      if (locked) {
        name = `${LOCK_PREFIX}${name}`;
        chapterId += LOCK_SUFFIX;
      }

      chapters.push({
        chapterId,
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

  private isLocked($: CheerioAPI, el: Cheerio<AnyNode>): boolean {
    const reason = (el.attr("data-reason") || "").toLowerCase();
    if (reason && reason !== "free") return true;
    if (el.hasClass("locked-chapter")) return true;
    const href = el.find("a").first().attr("href") || "";
    if (!href || href === "#") return true;
    return el.find(".chapter_price").length > 0;
  }

  private async fetchMoreChapters(
    comicId: string,
    offset: number,
    nonce: string,
    sourceManga: SourceManga,
  ): Promise<Chapter[]> {
    const body = [
      "action=load_more_chapters",
      `nonce=${encodeURIComponent(nonce)}`,
      `comic_id=${encodeURIComponent(comicId)}`,
      `offset=${offset}`,
    ].join("&");

    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/wp-admin/admin-ajax.php`,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
      },
      body,
    });
    if (response.status === 404) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(Application.arrayBufferToUTF8String(data));
    } catch {
      return [];
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { success?: unknown }).success !== true
    ) {
      return [];
    }

    const html = (parsed as { data?: { html?: string } }).data?.html ?? "";
    if (!html) return [];

    const dom = htmlparser2.parseDocument(html);
    const $ = cheerio.load(dom);
    return this.parseChapterElements($, $(CHAPTER_SELECTOR), sourceManga);
  }

  private extractNonce($: CheerioAPI): string | undefined {
    const match = $.html().match(NONCE_REGEX);
    return match ? match[1] : undefined;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.chapterId.includes(LOCK_SUFFIX)) {
      throw new Error(
        "This chapter is locked. Use WebView to purchase it.",
      );
    }

    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("img.chapter-image").each((_, element) => {
      const el = $(element);
      const src = (el.attr("data-src") || el.attr("src") || "").trim();
      if (src) pages.push(this.absoluteUrl(src));
    });

    if (pages.length === 0) {
      throw new Error("Chapter is locked or unavailable.");
    }

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

  private comicsUrl(page: number): string {
    if (page <= 1) return `${BASE_URL}/comic/`;
    return `${BASE_URL}/comic/page/${page}/`;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const cleaned = chapterId.replace(LOCK_SUFFIX, "");
    const slug = this.safeDecode(cleaned);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseDate(date: string): Date {
    const trimmed = (date || "").trim();
    if (!trimmed) return new Date(0);
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) return new Date(parsed);
    return new Date(0);
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("src") ||
      "";
    return this.absoluteUrl(src);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").trim().toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancel")) return "Cancelled";
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
}

export const RinkoComics = new RinkoComicsExtension();
