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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://randowis.com";

const MAX_PAGES = 50;

interface SeriesEntry {
  url: string;
  title: string;
  author: string;
  description: string;
  thumbnail: string;
}

const SERIES: SeriesEntry[] = [
  {
    url: "/category/we-live-in-an-mmo/",
    title: "Randowiz: We live in an MMO!?",
    author: "Randowiz",
    description:
      "The world of 'Mamuon' where players and NPC's live together in harmony. Or do they? DO THEY?",
    thumbnail:
      "https://i0.wp.com/randowis.com/wp-content/uploads/2016/02/MMO_CHP_001_CSP_000.jpg?resize=800%2C800&ssl=1",
  },
  {
    url: "/category/short-comics/",
    title: "Randowiz: Short comics",
    author: "Randowiz",
    description: "So short that i have to compensate..",
    thumbnail:
      "https://i0.wp.com/randowis.com/wp-content/uploads/2021/10/Images_PNGs_Site_BOT-SUPPORT.png",
  },
  {
    url: "/category/art/",
    title: "Randowiz: Illustations",
    author: "Randowiz",
    description: "You like draw? I give you draw.",
    thumbnail:
      "https://i0.wp.com/randowis.com/wp-content/uploads/2021/05/colour-studies-021-post.jpg",
  },
];

class RandowizInterceptor extends PaperbackInterceptor {
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

type RandowizImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class RandowizExtension implements RandowizImplementation {
  requestManager = new RandowizInterceptor("main");
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
        id: "series",
        title: "Randowiz",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = SERIES.map((s) => ({
      type: "featuredCarouselItem",
      mangaId: this.toSafeId(s.url.replace(/^\/+/, "")),
      imageUrl: s.thumbnail,
      title: s.title,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const items: SearchResultItem[] = SERIES.filter(
      (s) => titleQuery === "" || s.title.toLowerCase().includes(titleQuery),
    ).map((s) => ({
      mangaId: this.toSafeId(s.url.replace(/^\/+/, "")),
      imageUrl: s.thumbnail,
      title: s.title,
      subtitle: undefined,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId).replace(/^\/+/, "").replace(/\/+$/, "");
    const series =
      SERIES.find(
        (s) => s.url.replace(/^\/+/, "").replace(/\/+$/, "") === slug,
      ) ?? SERIES[0];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: [],
        thumbnailUrl: series.thumbnail,
        author: series.author,
        artist: series.author,
        synopsis: series.description,
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
        tagGroups: [],
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    let url = this.mangaUrl(sourceManga.mangaId);

    const entries: { chapterId: string; name: string; date: Date }[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < MAX_PAGES; i++) {
      const $ = await this.fetchCheerio({ url, method: "GET" });

      $(".has-post-thumbnail").each((_index, element) => {
        const el = $(element);
        const linkTag = el.find(".elementor-post__title a").first();
        const href = linkTag.attr("href") || "";
        if (!href) return;
        const chapterId = this.parsePath(href);
        if (!chapterId || seen.has(chapterId)) return;
        seen.add(chapterId);
        const dateText = el.find(".elementor-post-date").first().text().trim();
        entries.push({
          chapterId,
          name: linkTag.text().trim(),
          date: this.parseDate(dateText),
        });
      });

      const nextUrl = $(".next").first().attr("href") || "";
      if (!nextUrl) break;
      url = this.absoluteUrl(nextUrl);
    }

    return entries.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: entries.length - index,
      publishDate: entry.date,
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $(".elementor-widget-theme-post-content img").each((_index, element) => {
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

  private parseDate(text: string): Date {
    // Upstream format: dd/MM/yyyy
    const m = (text || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return new Date(0);
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? new Date(0) : d;
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

export const Randowiz = new RandowizExtension();
