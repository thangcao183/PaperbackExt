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
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://www.viz.com";
// VizFactory exposes two services ("shonenjump" and "vizmanga"); this standalone
// ports the broader "vizmanga" catalog.
const SERVICE_PATH = "vizmanga";
const FREE_CHAPTERS_URL = `${BASE_URL}/read/${SERVICE_PATH}/section/free-chapters`;

const DATE_REGEX = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

class VIZInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/${SERVICE_PATH}`,
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

type VIZImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class VIZExtension implements VIZImplementation {
  requestManager = new VIZInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
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
        id: "free",
        title: "Free Chapters",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const series = await this.fetchSeriesList();
    const items: DiscoverSectionItem[] = series.map((s) => ({
      type: "featuredCarouselItem",
      mangaId: s.mangaId,
      imageUrl: s.imageUrl,
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
    const series = await this.fetchSeriesList();

    const results: SearchResultItem[] = series
      .filter(
        (s) => titleQuery === "" || s.title.toLowerCase().includes(titleQuery),
      )
      .map((s) => ({
        mangaId: s.mangaId,
        imageUrl: s.imageUrl,
        title: s.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items: results, metadata: undefined };
  }

  private async fetchSeriesList(): Promise<
    { mangaId: string; title: string; imageUrl: string }[]
  > {
    const $ = await this.fetchCheerio({ url: FREE_CHAPTERS_URL, method: "GET" });

    const out: { mangaId: string; title: string; imageUrl: string }[] = [];
    const seen = new Set<string>();
    $(
      "section.section_chapters div.o_sort_container div.o_sortable > a.o_chapters-link",
    ).each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      const title = el.find("div.pad-x-rg").first().text().trim();
      const imageUrl = this.imageFromElement(
        el.find("div.pos-r img.disp-bl").first(),
      );
      if (!title) return;
      out.push({ mangaId, title, imageUrl });
    });

    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const seriesIntro = $("section#series-intro").first();

    const author =
      seriesIntro
        .find("div.type-rg span")
        .first()
        .text()
        .replace("Created by ", "")
        .trim() || undefined;
    const synopsis = seriesIntro.find("div.line-solid").first().text().trim();

    let thumbnailUrl = this.imageFromElement(
      $("section.section_chapters td a > img").first(),
    );
    if (!thumbnailUrl) {
      thumbnailUrl = this.imageFromElement(seriesIntro.find("img").first());
    }

    const title =
      seriesIntro.find("h2.type-lg").first().text().trim() ||
      this.safeDecode(mangaId);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author,
        artist: author,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
        tagGroups: [],
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

    $(
      "section.section_chapters div.o_sortable > a.o_chapter-container, section.section_chapters div.o_sortable div.o_chapter-vol-container tr.o_chapter a.o_chapter-container",
    ).each((_, element) => {
      const el = $(element);

      const isVolume = el.find("div:nth-child(1) table").length === 0;
      let name: string;
      let publishDate = new Date(0);

      if (isVolume) {
        name = el.text().trim();
      } else {
        const rightSide = el.find("div:nth-child(2) table").first();
        name = rightSide.find("td").first().text().trim();
        const dateStr = el
          .find("div:nth-child(1) table td[align=right]")
          .first()
          .text()
          .trim();
        publishDate = this.parseDate(dateStr);
      }

      const targetUrl = el.attr("data-target-url") || "";
      // Only free (non-locked) chapters are reachable without a login; locked
      // ones use a "javascript:" target which we skip.
      if (!targetUrl || targetUrl.startsWith("javascript")) return;

      const chapterId = this.parsePath(targetUrl);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate,
        langCode: "🇬🇧",
      });
    });

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    let pageCount = 0;
    $("script").each((_, element) => {
      const data = $(element).html() || "";
      if (data.includes("var pages")) {
        const m = data.match(/var\s+pages\s*=\s*(\d+)/);
        if (m) pageCount = parseInt(m[1], 10);
      }
    });

    const mangaId = url.replace(/[?#].*$/, "").split("/").pop() || "";

    const pages: string[] = [];
    for (let i = 0; i <= pageCount; i++) {
      const params = [
        "device_id=3",
        `manga_id=${encodeURIComponent(mangaId)}`,
        `pages=${i}`,
      ].join("&");
      pages.push(`${BASE_URL}/manga/get_manga_url?${params}`);
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

  private parseChapterNumber(name: string): number {
    const after = name.includes("Ch. ") ? name.split("Ch. ")[1] : name;
    const m = (after || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : -1;
  }

  private parseDate(dateStr: string): Date {
    const m = (dateStr || "").match(DATE_REGEX);
    if (!m) return new Date(0);
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) return new Date(0);
    return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-original") ||
      img.attr("data-src") ||
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

export const VIZ = new VIZExtension();
