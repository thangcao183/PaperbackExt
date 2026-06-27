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

const BASE_URL = "https://hentaikisu.com";

interface HentaiKisuMetadata {
  page?: number;
}

interface PopularDto {
  id: string;
  title: string;
  img: string;
}

const LA_REGEX = /la\s*=\s*'([A-Za-z0-9+/=]+)'/;

class HentaiKisuInterceptor extends PaperbackInterceptor {
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

type HentaiKisuImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class HentaiKisuExtension implements HentaiKisuImplementation {
  requestManager = new HentaiKisuInterceptor("main");
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
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id !== "popular") {
      return { items: [], metadata: undefined };
    }

    const meta = metadata as HentaiKisuMetadata | undefined;
    const page = meta?.page ?? 1;
    const entries = await this.fetchPopular(page);

    const items: DiscoverSectionItem[] = entries.map((entry) => ({
      type: "simpleCarouselItem",
      mangaId: entry.mangaId,
      imageUrl: entry.imageUrl,
      title: entry.title,
      metadata: undefined,
    }));

    return {
      items,
      metadata: entries.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  private async fetchPopular(
    page: number,
  ): Promise<{ mangaId: string; imageUrl: string; title: string }[]> {
    const url = `${BASE_URL}/backend/infinite.index.php?p=${page}`;
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      return [];
    }
    const jsonStr = Application.arrayBufferToUTF8String(data);
    let parsed: PopularDto[];
    try {
      parsed = JSON.parse(jsonStr) as PopularDto[];
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.map((dto) => ({
      mangaId: this.parsePath(`/g/${dto.id}`),
      imageUrl: this.absoluteUrl(dto.img),
      title: dto.title,
    }));
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const url = `${BASE_URL}/search?s=${encodeURIComponent(titleQuery)}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("div.book-list a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;

      const title = el.find("div.book-description p").first().text().trim();
      if (!title) return;
      seen.add(mangaId);

      const imageUrl = this.imageFromElement(el.find("img.lozad").first());
      results.push({
        mangaId,
        imageUrl,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    return { items: results, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("div#info h1").first().text().trim() || this.safeDecode(mangaId);
    const thumbnailUrl = this.imageFromElement(
      $("div#cover img").first(),
    );
    const artist = $("div.tag-container:contains(Artist:) span.tags")
      .first()
      .text()
      .trim();
    const author = $("div.tag-container:contains(Group:) span.tags")
      .first()
      .text()
      .trim();

    const genres = $(
      "div.tag-container:contains(Categories:) span.tags a.tag",
    )
      .map((_, el) => $(el).clone().children().remove().end().text().trim())
      .get()
      .filter((g) => g.length > 0);

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      tagGroups.push({
        id: "categories",
        title: "Categories",
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
    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaUrl = this.mangaUrl(chapter.chapterId);
    const readUrl = mangaUrl.replace("/g/", "/read/");
    const $ = await this.fetchCheerio({ url: readUrl, method: "GET" });

    let scriptContent = "";
    $("script").each((_, element) => {
      const data = $(element).text();
      if (data.includes("la =") || /la\s*=/.test(data)) {
        if (LA_REGEX.test(data)) {
          scriptContent = data;
        }
      }
    });

    if (!scriptContent) {
      throw new Error("Could not find page data");
    }

    const match = scriptContent.match(LA_REGEX);
    if (!match) {
      throw new Error("Could not extract base64 data");
    }

    const decoded = this.base64Decode(match[1]);
    const pages = decoded
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => this.absoluteUrl(u));

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

  private base64Decode(input: string): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const str = input.replace(/[^A-Za-z0-9+/=]/g, "");
    let output = "";
    let i = 0;
    while (i < str.length) {
      const e1 = chars.indexOf(str.charAt(i++));
      const e2 = chars.indexOf(str.charAt(i++));
      const e3 = chars.indexOf(str.charAt(i++));
      const e4 = chars.indexOf(str.charAt(i++));
      const c1 = (e1 << 2) | (e2 >> 4);
      const c2 = ((e2 & 15) << 4) | (e3 >> 2);
      const c3 = ((e3 & 3) << 6) | e4;
      output += String.fromCharCode(c1);
      if (e3 !== 64 && e3 !== -1) output += String.fromCharCode(c2);
      if (e4 !== 64 && e4 !== -1) output += String.fromCharCode(c3);
    }
    return output;
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

export const HentaiKisu = new HentaiKisuExtension();
