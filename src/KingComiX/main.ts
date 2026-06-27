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

const BASE_URL = "https://kingcomix.com";

interface KingComiXMetadata {
  page?: number;
  // Genre browse: "category" or "tag" + slug.
  kind?: "category" | "tag";
  slug?: string;
}

// Categories exposed for genre browsing (label, slug).
const CATEGORIES: [string, string][] = [
  ["3D Porn Comics", "3d-porn-comics-xxx"],
  ["Adventure Time Porn", "adventure-time"],
  ["American Dad Porn", "american-dad-xx-porn-comix"],
  ["Attack on Titan Hentai", "attack-on-titan-hentai"],
  ["Ben 10 Porn Comics", "ben-10-porn-comics-v1"],
  ["Chainsaw Man Porn Comics", "porn-chainsaw-man-porn-comics"],
  ["Dragon Ball Porn", "dragon-ball-z-porn-comics-v1"],
  ["Exclusive", "exclusive"],
  ["Furry Porn Comics", "porn-comic-furry"],
  ["Hentai Manga", "xxxx-manga"],
  ["Interracial Porn", "interracial-porn-comix2-xxx"],
  ["Kim Possible Porn", "kim-possible-porn1"],
  ["LoL Hentai", "lol-hentai-xxx-comics1"],
  ["My Hero Academia Hentai", "hero-academia-porn-comic-v1"],
  ["Naruto Hentai", "naruto-hentai-comic4"],
  ["One Piece Hentai", "one-piece-hentai-v2"],
  ["Palcomix", "palcomix"],
  ["Pokemon Porn", "pokemon-porn-comics-v1"],
  ["Porn Comics", "porn-c0mics"],
  ["Princess Peach Porn", "princess-peach-porn-xxx"],
  ["Rick and Morty Porn Comics", "rick-and-morty-porn-comics"],
  ["Simpsons Porn", "simpsons-xxx-porn-comics"],
  ["Sonic Porn Comics", "sonic_porn-comics"],
  ["Sword Art Online Hentai", "sword-art-online-xxx-hentai1"],
  ["Teen Titans Porn", "teen-titans-porn-v1"],
];

class KingComiXInterceptor extends PaperbackInterceptor {
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

type KingComiXImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class KingComiXExtension implements KingComiXImplementation {
  requestManager = new KingComiXInterceptor("main");
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
        title: "Latest",
        type: DiscoverSectionType.featured,
      },
      {
        id: "categories",
        title: "Categories",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "categories") {
      const items: DiscoverSectionItem[] = CATEGORIES.map(([label, slug]) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { kind: "category", slug } as Metadata,
        },
        name: label,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as KingComiXMetadata | undefined;
    const page = meta?.page ?? 1;
    const $ = await this.fetchCheerio({
      url: this.listUrl(page),
      method: "GET",
    });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("div.entry, article.thumb-block").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed || seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type: "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items,
      metadata: hasNextPage ? ({ page: page + 1 } as Metadata) : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as KingComiXMetadata | undefined;
    const pageMeta = metadata as KingComiXMetadata | undefined;
    const page = pageMeta?.page ?? 1;

    let url: string;
    let isTextSearch = false;
    if (titleQuery) {
      // Text search does not support pagination on the site.
      url = `${BASE_URL}/?s=${encodeURIComponent(titleQuery)}`;
      isTextSearch = true;
    } else if (queryMeta?.slug) {
      const segment = queryMeta.kind === "tag" ? "tag" : "category";
      url = this.browseUrl(segment, queryMeta.slug, page);
    } else {
      url = this.listUrl(page);
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("div.entry, article.thumb-block").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed || seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = !isTextSearch && this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage
        ? ({ ...queryMeta, page: page + 1 } as Metadata)
        : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const a = el.find("h2.information a, a[title]").first();
    const href = a.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = (a.text().trim() || a.attr("title") || "").trim();
    const imageUrl = this.imageFromElement(el.find("img").first());
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1.singleTitle-h1, h1.widget-title").first().text().trim() ||
      this.safeDecode(mangaId);
    const author = $("meta[name=author]").attr("content")?.trim() || undefined;

    const genres = $(".caTotal .tagsPost a.taxLink")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const thumbnailUrl =
      $("meta[property=og:image]").attr("content")?.trim() ||
      this.absoluteUrl($(".entry-content img").first().attr("src") || "");

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
        author,
        artist: author,
        synopsis: "",
        contentRating: ContentRating.MATURE,
        status: "Completed",
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

    const published = $("meta[property=article:published_time]")
      .attr("content")
      ?.trim();
    const publishDate = this.parseDate(published);

    // The site presents each comic as a single readable entry.
    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate,
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.mangaUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $(".entry-content img").each((_, element) => {
      const img = $(element);
      const src = img.attr("data-src") || img.attr("src") || "";
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

  private listUrl(page: number): string {
    return page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`;
  }

  private browseUrl(segment: string, slug: string, page: number): string {
    const base = `${BASE_URL}/${segment}/${slug}`;
    return page > 1 ? `${base}/page/${page}/` : `${base}/`;
  }

  private hasNextPage($: CheerioAPI): boolean {
    return (
      $(".pagination a.next").length > 0 ||
      $(".pagination a")
        .toArray()
        .some((el) => $(el).text().trim().toLowerCase().includes("next"))
    );
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
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

  private parseDate(value: string | undefined): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
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

export const KingComiX = new KingComiXExtension();
