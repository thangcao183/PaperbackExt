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

const BASE_URL = "https://manhuascans.org";

interface GodaMetadata {
  page?: number;
  genre?: string;
}

class GodaInterceptor extends PaperbackInterceptor {
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

type GodaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class GodaExtension implements GodaImplementation {
  requestManager = new GodaInterceptor("main");
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
    const meta = metadata as GodaMetadata | undefined;
    const page = meta?.page ?? 1;

    if (section.id === "genres") {
      const url = `${BASE_URL}/hots/page/1`;
      const $ = await this.fetchCheerio({ url, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      const box = $("h2").first().parent().parent();
      box.find("a").each((_, element) => {
        const el = $(element);
        const href = el.attr("href") || "";
        if (!href) return;
        const title = el.text().replace(/^#/, "").trim();
        if (!title) return;
        const genrePath = this.parsePath(href);
        if (seen.has(genrePath)) return;
        seen.add(genrePath);
        items.push({
          type: "genresCarouselItem",
          searchQuery: {
            title: "",
            metadata: { genre: genrePath },
          },
          name: title,
          metadata: { genre: genrePath },
        });
      });
      return { items, metadata: undefined };
    }

    const url =
      section.id === "popular"
        ? `${BASE_URL}/hots/page/${page}`
        : `${BASE_URL}/newss/page/${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".container > .cardlist .pb-2 a").each((_, element) => {
      const el = $(element);
      const parsed = this.itemFromElement($, el);
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as GodaMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as GodaMetadata | undefined;
    const genre = meta?.genre ?? queryMeta?.genre;

    let url: string;
    if (titleQuery) {
      url = `${BASE_URL}/s/${encodeURIComponent(titleQuery)}?page=${page}`;
    } else if (genre) {
      url = `${BASE_URL}/${this.safeDecode(genre).replace(/^\/+/, "")}/page/${page}`;
    } else {
      url = `${BASE_URL}/hots/page/${page}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $(".container > .cardlist .pb-2 a").each((_, element) => {
      const el = $(element);
      const parsed = this.itemFromElement($, el);
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1, genre } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const href = el.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.getKey(href);
    if (!mangaId) return undefined;
    const title = el.find("h3").first().text().trim();
    const imageUrl = this.imageFromElement($, el.find("img").first());
    if (!title || !imageUrl) return undefined;
    return { mangaId, imageUrl, title };
  }

  private hasNextPage($: CheerioAPI): boolean {
    return $("a[aria-label=NEXT] button").length > 0;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const main = $("main").first();
    const titleEl = main.find("h1").first();
    const title = titleEl.first().contents().filter((_, n) => n.type === "text")
      .text()
      .trim() || this.safeDecode(mangaId);

    const statusText = titleEl.children().first().text().trim();

    const container = titleEl.parent().parent();
    const children = container.children();

    // children[1] -> authors, children[2] -> genres, children[3] -> tags, children[4] -> description
    const authorEl = children.eq(1);
    const author = authorEl
      .children()
      .slice(1)
      .map((_, c) => $(c).text().replace(/ ,$/, "").trim())
      .get()
      .filter((a) => a.length > 0)
      .join(", ");

    const genres: string[] = [];
    children
      .eq(2)
      .children()
      .slice(1)
      .each((_, c) => {
        const t = $(c).text().replace(/ ,$/, "").trim();
        if (t) genres.push(t);
      });
    children
      .eq(3)
      .children()
      .each((_, c) => {
        const t = $(c).text().replace(/^#/, "").trim();
        if (t) genres.push(t);
      });

    const description = children.eq(4).text().trim();

    const mid = main.find("#mangachapters").attr("data-mid") || "";

    const thumbnailUrl = this.imageFromElement(
      $,
      main.find("img.object-cover").first(),
    );

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
        artist: undefined,
        synopsis: description,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
        // store the numeric manga id as part of the description-free path
        additionalInfo: mid ? { mid } : undefined,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // Need the numeric manga id (data-mid) to query the chapter API.
    const mid = await this.resolveMangaId(sourceManga);
    if (!mid) return [];

    const url = `${BASE_URL}/manga/get?mid=${encodeURIComponent(mid)}&mode=all`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const entries: { chapterId: string; name: string }[] = [];
    $(".chapteritem").each((_, element) => {
      const el = $(element);
      const anchor = el.find("a").first();
      const href = anchor.attr("href") || "";
      if (!href) return;
      const slug = this.getKey(href);
      const cs = anchor.attr("data-cs") || "";
      const name = anchor.attr("data-ct") || anchor.text().trim();
      // chapterId encodes: <slug>#<mid>/<cs>
      const chapterId = this.toSafeId(`${slug}#${mid}/${cs}`);
      entries.push({ chapterId, name });
    });

    // Upstream reverses the list so the array is oldest -> newest.
    entries.reverse();

    return entries.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: index + 1,
      publishDate: new Date(0),
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const fragment = decoded.substring(decoded.lastIndexOf("#") + 1);
    const mangaId = fragment.substring(0, fragment.indexOf("/"));
    const chapterId = fragment.substring(fragment.indexOf("/") + 1);

    const url = `${BASE_URL}/chapter/getcontent?m=${encodeURIComponent(
      mangaId,
    )}&c=${encodeURIComponent(chapterId)}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("#chapcontent > div > img").each((_, element) => {
      const el = $(element);
      const src = el.attr("data-src") || el.attr("src") || "";
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

  private async resolveMangaId(sourceManga: SourceManga): Promise<string> {
    const info = sourceManga.mangaInfo as { additionalInfo?: { mid?: string } };
    const cached = info?.additionalInfo?.mid;
    if (cached) return cached;

    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });
    return $("#mangachapters").attr("data-mid") || "";
  }

  private getKey(link: string): string {
    const decoded = this.safeDecode(link);
    const cleaned = decoded.replace(/[?#].*$/, "");
    const afterManga = cleaned.includes("/manga/")
      ? cleaned.substring(cleaned.indexOf("/manga/") + "/manga/".length)
      : cleaned.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
    const slug = afterManga.replace(/\/+$/, "");
    return this.toSafeId(slug);
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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

  private imageFromElement($: CheerioAPI, img: Cheerio<AnyNode>): string {
    const raw =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    const src = raw.trim();
    if (!src) return "";
    // Some thumbnails are wrapped in an image-proxy: ?url=<actual>
    const urlMatch = src.match(/[?&]url=([^&]+)/);
    if (urlMatch) {
      return this.safeDecode(urlMatch[1]);
    }
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
    const s = (status || "").trim();
    if (s === "連載中" || s.toLowerCase() === "ongoing") return "Ongoing";
    if (s === "完結") return "Completed";
    if (s === "停止更新") return "Cancelled";
    if (s === "休刊") return "Hiatus";
    const lower = s.toLowerCase();
    if (lower.includes("ongoing")) return "Ongoing";
    if (lower.includes("complet")) return "Completed";
    if (lower.includes("hiatus")) return "Hiatus";
    if (lower.includes("cancel")) return "Cancelled";
    return "Unknown";
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

export const Goda = new GodaExtension();
