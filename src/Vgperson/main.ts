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
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

// Upstream baseUrl is the full viewer endpoint; manga/chapter ids are the
// query-string portion (e.g. "?m=...", "?c=...") appended to BASE_URL.
const BASE_URL = "https://vgperson.com/other/mangaviewer.php";
const ORIGIN = "https://vgperson.com";

// Known manga covers hosted on imgur (ported from upstream getCover()).
const COVERS: Record<string, string> = {
  "The Festive Monster's Cheerful Failure": "kEK10GL.png",
  "Azure and Claude": "buXnlmh.jpg",
  "Three Days of Happiness": "kL5dvnp.jpg",
};

function getCover(title: string): string {
  const file = COVERS[title];
  return file ? `https://i.imgur.com/${file}` : "";
}

class VgpersonInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}`,
      origin: ORIGIN,
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

type VgpersonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class VgpersonExtension implements VgpersonImplementation {
  requestManager = new VgpersonInterceptor("main");
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
        title: "All Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const entries = await this.fetchMangaList();
    const items: DiscoverSectionItem[] = entries.map((entry) => ({
      type: "simpleCarouselItem",
      mangaId: entry.mangaId,
      imageUrl: getCover(entry.title),
      title: entry.title,
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
    const entries = await this.fetchMangaList();

    const results: SearchResultItem[] = entries
      .filter(
        (entry) =>
          titleQuery === "" ||
          entry.title.toLowerCase().includes(titleQuery),
      )
      .map((entry) => ({
        mangaId: entry.mangaId,
        imageUrl: getCover(entry.title),
        title: entry.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items: results, metadata: undefined };
  }

  private async fetchMangaList(): Promise<
    { mangaId: string; title: string }[]
  > {
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
    const entries: { mangaId: string; title: string }[] = [];
    const seen = new Set<string>();

    $(".content a[href^='?m']").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const title = el.text().trim();
      if (!title) return;
      const mangaId = this.toSafeId(href);
      if (seen.has(mangaId)) return;
      seen.add(mangaId);
      entries.push({ mangaId, title });
    });

    return entries;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $(".title").first().text().trim() || this.safeDecode(mangaId);

    const completeText = $("div.content .complete").first().text().trim();
    let status = "Unknown";
    if (completeText === "(Complete)") status = "Completed";
    else if (completeText === "(Series in Progress)") status = "Ongoing";

    const synopsis = this.parseSynopsis($);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: getCover(title),
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status,
        tagGroups: [],
        shareUrl: url,
      },
    };
  }

  private parseSynopsis($: CheerioAPI): string {
    const content = $(".content").first();
    if (content.length === 0) return "";

    // Upstream drops the first 5 child nodes then takes nodes until <table>.
    const nodes: AnyNode[] = content.contents().toArray().slice(5);
    let out = "";
    for (const n of nodes) {
      if (n.type === "tag") {
        const name = n.name.toLowerCase();
        if (name === "table") break;
        if (name === "br") {
          out += "\n";
        } else {
          out += $(n).text();
        }
      } else if (n.type === "text") {
        out += n.data;
      }
    }
    return out.trim();
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $(".chaptertable tbody tr").each((_, element) => {
      const row = $(element);
      const link = row.find("td > a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      let name = link.text().trim();

      // Append the trailing cell's text (subtitle), trimming a leading hyphen.
      const lastCell = row.find("td:last-child:not(:first-child)").first();
      if (lastCell.length > 0) {
        const extra = lastCell.text();
        const idx = extra.indexOf("- ");
        const suffix = idx >= 0 ? extra.slice(idx + 2) : extra;
        name += ` - ${suffix.trim()}`;
      }

      const chapterId = this.toSafeId(href);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(href),
        publishDate: new Date(0),
        langCode: "🇬🇧",
      });
    });

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("img").each((_, element) => {
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
    return this.idToUrl(mangaId);
  }

  private chapterUrl(chapterId: string): string {
    return this.idToUrl(chapterId);
  }

  private idToUrl(id: string): string {
    const decoded = this.safeDecode(id);
    if (decoded.startsWith("http")) return decoded;
    // ids are query strings like "?m=..." or "?c=..." appended to BASE_URL.
    return `${BASE_URL}${decoded}`;
  }

  // Derive the chapter number from the query string, mirroring upstream:
  // use ?c=<num>, else 16.5 + (?b / 10) for the Three Days of Happiness case.
  private parseChapterNumber(href: string): number {
    const c = this.queryParam(href, "c");
    if (c !== undefined) {
      const n = parseFloat(c);
      if (!isNaN(n)) return n;
    }
    const b = this.queryParam(href, "b");
    if (b !== undefined) {
      const n = parseFloat(b);
      if (!isNaN(n)) return 16.5 + n / 10;
    }
    return 0;
  }

  private queryParam(href: string, key: string): string | undefined {
    const q = href.indexOf("?");
    const query = q >= 0 ? href.slice(q + 1) : href;
    for (const part of query.split("&")) {
      const eq = part.indexOf("=");
      const k = eq >= 0 ? part.slice(0, eq) : part;
      if (k === key) {
        const v = eq >= 0 ? part.slice(eq + 1) : "";
        return this.safeDecode(v);
      }
    }
    return undefined;
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

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${ORIGIN}${s}` : `${ORIGIN}/${s}`;
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

export const Vgperson = new VgpersonExtension();
