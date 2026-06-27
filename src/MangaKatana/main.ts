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
import { MangaKatanaSearchForm, MangaKatanaSearchMeta } from "./forms";

const BASE_URL = "https://mangakatana.com";

interface MangaKatanaMetadata {
  page?: number;
}

class MangaKatanaInterceptor extends PaperbackInterceptor {
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

type MangaKatanaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaKatanaExtension implements MangaKatanaImplementation {
  requestManager = new MangaKatanaInterceptor("main");
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
      | { searchMeta?: MangaKatanaSearchMeta }
      | undefined;
    return new MangaKatanaSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaKatanaMetadata | undefined;
    const page = meta?.page ?? 1;

    let url: string;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";
    if (section.id === "popular") {
      // Popular is actually the alphabetical manga listing.
      url = `${BASE_URL}/manga/page/${page}`;
      itemType = "featuredCarouselItem";
    } else {
      url = `${BASE_URL}/page/${page}`;
      itemType = "simpleCarouselItem";
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    $("div#book_list > div.item").each((_, element) => {
      const el = $(element);
      const parsed = this.parseListItem($, el);
      if (!parsed) return;
      items.push({
        type: itemType,
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = $("a.next.page-numbers").length > 0;
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
    const meta = metadata as MangaKatanaMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangaKatanaSearchMeta } | undefined
    )?.searchMeta;

    const url = this.buildSearchUrl(titleQuery, searchMeta, page);

    // MangaKatana returns HTTP 404 for searches that match nothing
    // (e.g. single-character queries while the user is still typing).
    // Treat that as an empty result set rather than surfacing an error.
    let $: CheerioAPI;
    try {
      $ = await this.fetchCheerio({ url, method: "GET" });
    } catch {
      return { items: [], metadata: undefined };
    }

    // A text search may redirect straight to a single manga detail page.
    if ($("div#book_list").length === 0 && $("h1.heading").length > 0) {
      const title = $("h1.heading").first().text().trim();
      const imageUrl = this.absoluteUrl(
        $("div.media div.cover img").first().attr("src") || "",
      );
      return {
        items: [
          {
            mangaId: this.parsePath(url),
            imageUrl,
            title,
            subtitle: undefined,
            metadata: undefined,
          },
        ],
        metadata: undefined,
      };
    }

    const results: SearchResultItem[] = [];
    $("div#book_list > div.item").each((_, element) => {
      const el = $(element);
      const parsed = this.parseListItem($, el);
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $("a.next.page-numbers").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    query: string,
    searchMeta: MangaKatanaSearchMeta | undefined,
    page: number,
  ): string {
    if (query) {
      const searchBy = searchMeta?.searchBy?.[0] || "book_name";
      return `${BASE_URL}/page/${page}?search=${encodeURIComponent(
        query,
      )}&search_by=${searchBy}`;
    }

    const params: string[] = ["filter=1"];

    const include = searchMeta?.includeGenres ?? [];
    const exclude = searchMeta?.excludeGenres ?? [];
    if (include.length > 0) {
      params.push(`include=${include.join("_")}`);
    }
    if (exclude.length > 0) {
      params.push(`exclude=${exclude.join("_")}`);
    }

    const includeMode = searchMeta?.includeMode?.[0];
    if (includeMode) {
      params.push(`include_mode=${includeMode}`);
    }

    const order = searchMeta?.order?.[0];
    if (order) {
      params.push(`order=${order}`);
    }

    const status = searchMeta?.status?.[0];
    if (status) {
      params.push(`status=${status}`);
    }

    const minChapters = (searchMeta?.minChapters ?? "").trim();
    if (minChapters === "-1") {
      params.push("chapters=e1");
    } else if (minChapters === "") {
      params.push("chapters=1");
    } else {
      params.push(`chapters=${encodeURIComponent(minChapters)}`);
    }

    return `${BASE_URL}/manga/page/${page}?${params.join("&")}`;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const thumbnailUrl = this.absoluteUrl(
      $("div.media div.cover img").first().attr("src") || "",
    );
    const title =
      $("h1.heading").first().text().trim() || this.safeDecode(mangaId);

    const authors = $(".author")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((a) => a.length > 0);
    const author = authors.join(", ");

    const summary = $(".summary > p").first().text().trim();
    const altName = $(".alt_name").first().text().trim();
    const synopsis = altName
      ? `${summary}\n\nAlt name(s): ${altName}`
      : summary;

    const statusText = $(".value.status").first().text().trim();

    const genres = $(".genres > a")
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
        secondaryTitles: altName ? [altName] : [],
        thumbnailUrl,
        author: author || undefined,
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
    $("tr:has(.chapter)").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const name = link.text().trim();
      const dateText = el.find(".update_time").first().text().trim();

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
    const script = $("script")
      .map((_, el) => $(el).html() || "")
      .get()
      .find((data) => data.includes("data-src"));

    if (script) {
      const arrNameMatch = script.match(/data-src['"],\s*(\w+)/);
      if (arrNameMatch) {
        const arrName = arrNameMatch[1];
        const arrBodyMatch = script.match(
          new RegExp("var " + arrName + "=\\[([^\\[]*)]"),
        );
        if (arrBodyMatch) {
          const urlMatches = arrBodyMatch[1].matchAll(/'([^']*)'/g);
          for (const m of urlMatches) {
            const u = m[1];
            if (u) pages.push(u);
          }
        }
      }
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

  private parseListItem(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; title: string; imageUrl: string } | undefined {
    const link = el.find("div.text > h3 > a").first();
    const href = link.attr("href") || "";
    // ownText: take the link's direct text only.
    const title = link.text().trim();
    if (!href || !title) return undefined;
    const imageUrl = this.absoluteUrl(el.find("img").first().attr("src") || "");
    return { mangaId: this.parsePath(href), title, imageUrl };
  }

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
    const s = status || "";
    if (s.includes("Ongoing")) return "Ongoing";
    if (s.includes("Completed")) return "Completed";
    return "Unknown";
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    // Format MMM-dd-yyyy (e.g. Jan-05-2024)
    const normalized = dateText.replace(/-/g, " ");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

export const MangaKatana = new MangaKatanaExtension();
