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

const BASE_URL = "https://kuramanga.com";
const PAGE_SIZE = 10;

const GENRE_NAMES = [
  "Action",
  "Adaptation",
  "Adult",
  "Adventure",
  "BL",
  "Borderline H",
  "College life",
  "Comedy",
  "Crime",
  "Drama",
  "Ecchi",
  "Explicit Sex",
  "Fantasy",
  "GL",
  "Gender Bender",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Loli",
  "Magic",
  "Magical",
  "Manhua",
  "Manhwa",
  "Martial Arts",
  "Mature",
  "Mystery",
  "Office Workers",
  "Psychological",
  "Reincarnation",
  "Revenge",
  "Romance",
  "School Life",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Slice of Life",
  "Smut",
  "Sport",
  "Supernatural",
  "Survival",
  "Thriller",
  "Time travel",
  "Tragedy",
  "Uncensored",
  "Vampire",
  "Violence",
  "Webtoons",
  "Yuri",
];

interface KuraMangaMetadata {
  page?: number;
  genre?: string;
}

interface SearchMangaDto {
  title: string;
  cover_image_url?: string | null;
  normalized_title: string;
}

interface SearchResponseDto {
  data: SearchMangaDto[];
  total: number;
}

class KuraMangaInterceptor extends PaperbackInterceptor {
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

type KuraMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class KuraMangaExtension implements KuraMangaImplementation {
  requestManager = new KuraMangaInterceptor("main");
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
    if (section.id === "genres") {
      const items: DiscoverSectionItem[] = GENRE_NAMES.map((genre) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre },
        },
        name: genre,
        metadata: { genre },
      }));
      return { items, metadata: undefined };
    }

    if (section.id === "latest") {
      const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $(".update-list .update-row").each((_, element) => {
        const el = $(element);
        const link = el.find("a.update-series-link").first();
        const href = link.attr("href") || "";
        if (!href) return;
        const mangaId = this.parsePath(href);
        if (!mangaId || seen.has(mangaId)) return;
        seen.add(mangaId);
        const title = link.text().trim();
        const imageUrl = this.imageFromElement(el.find("img").first());
        if (!title) return;
        items.push({
          type: "simpleCarouselItem",
          mangaId,
          imageUrl,
          title,
          metadata: undefined,
        });
      });
      return { items, metadata: undefined };
    }

    // popular
    const meta = metadata as KuraMangaMetadata | undefined;
    const page = meta?.page ?? 1;

    if (page === 1) {
      const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      $(".popular-glide .manga-card").each((_, element) => {
        const el = $(element);
        const titleEl = el.find(".manga-title").first();
        const title = titleEl.text().trim();
        if (!title) return;
        const href = el.attr("href") || "";
        if (!href) return;
        const mangaId = this.parsePath(href);
        if (!mangaId || seen.has(mangaId)) return;
        seen.add(mangaId);
        const imageUrl = this.imageFromElement(el.find("img.manga-thumb").first());
        items.push({
          type: "featuredCarouselItem",
          mangaId,
          imageUrl,
          title,
          metadata: undefined,
        });
      });
      return { items, metadata: { page: 2 } };
    }

    // popular page > 1 uses the search ajax endpoint
    const offset = (page - 1) * PAGE_SIZE;
    const result = await this.searchAjax({ offset });
    const items: DiscoverSectionItem[] = result.mangas.map((m) => ({
      type: "featuredCarouselItem",
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));
    return {
      items,
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
    const meta = metadata as KuraMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const offset = (page - 1) * PAGE_SIZE;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as KuraMangaMetadata | undefined;
    const genre = meta?.genre ?? queryMeta?.genre;

    const result = await this.searchAjax({
      offset,
      name: titleQuery || undefined,
      genre,
    });

    const items: SearchResultItem[] = result.mangas.map((m) => ({
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items,
      metadata: result.hasNextPage
        ? { page: page + 1, genre }
        : undefined,
    };
  }

  private async searchAjax(opts: {
    offset: number;
    name?: string;
    genre?: string;
    status?: string;
    adult?: boolean;
  }): Promise<{
    mangas: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  }> {
    const params: string[] = [];
    params.push("ajax=1");
    if (opts.name) params.push(`name=${encodeURIComponent(opts.name)}`);
    params.push(`offset=${opts.offset}`);
    if (opts.genre) params.push(`genre=${encodeURIComponent(opts.genre)}`);
    if (opts.status) params.push(`status=${encodeURIComponent(opts.status)}`);
    if (opts.adult === false) params.push("adult=0");

    const url = `${BASE_URL}/search?${params.join("&")}`;
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }

    const json = JSON.parse(
      Application.arrayBufferToUTF8String(data),
    ) as SearchResponseDto;

    const list = Array.isArray(json.data) ? json.data : [];
    const total = typeof json.total === "number" ? json.total : 0;

    const mangas = list.map((m) => ({
      mangaId: this.parsePath(`/${m.normalized_title}`),
      imageUrl: this.absoluteUrl(m.cover_image_url || ""),
      title: m.title,
    }));

    const hasNextPage =
      list.length === PAGE_SIZE && opts.offset + list.length < total;

    return { mangas, hasNextPage };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1.manga-title").first().text().trim() || this.safeDecode(mangaId);
    const synopsis = $(".summary-inner").first().text().trim();
    const author = $(".meta-grid div:contains(Author:)")
      .first()
      .text()
      .split("Author:")[1]
      ?.trim();
    const artist = $(".meta-grid div:contains(Artist:)")
      .first()
      .text()
      .split("Artist:")[1]
      ?.trim();
    const statusText = $(".meta-grid div:contains(Status:)")
      .first()
      .text()
      .split("Status:")[1]
      ?.trim();
    const thumbnailUrl = this.absoluteUrl(
      $("meta[property='og:image']").first().attr("content") || "",
    );

    const genres = $(".genre-list a.genre-chip")
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
        artist: artist || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
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
    const seen = new Set<string>();
    const elements = $(".chapter-list .chapter-item").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = link.text().trim();
      const dateText = el.find("time").first().text().trim();

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name) ?? elements.length - index,
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
    $("#chapterImages img").each((_, element) => {
      const src =
        $(element).attr("data-src") || $(element).attr("src") || "";
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

  private parseChapterNumber(name: string): number | undefined {
    const m = (name || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : undefined;
  }

  private parseDate(text: string): Date {
    const s = (text || "").trim();
    if (!s) return new Date(0);
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t);
    return new Date(0);
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
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

  private parseStatus(status: string | undefined): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing") || s.includes("upcoming")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("on_hold") || s.includes("on hold")) return "Hiatus";
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

export const KuraManga = new KuraMangaExtension();
