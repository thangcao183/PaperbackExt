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

const BASE_URL = "https://read.manga-bay.org";

interface MangaBayMetadata {
  page?: number;
}

interface ChapterDtoJson {
  id: number;
  title: string;
  date?: string;
}

interface ChapterListDtoJson {
  news_id: number;
  chapters: ChapterDtoJson[];
}

interface PageListDtoJson {
  images: string[];
}

class MangaBayInterceptor extends PaperbackInterceptor {
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

type MangaBayImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaBayExtension implements MangaBayImplementation {
  requestManager = new MangaBayInterceptor("main");
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

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaBayMetadata | undefined;
    const page = meta?.page ?? 1;

    // Upstream uses a POST form to /comix/ with dlenewssortby (rating for
    // popular, date for latest). We honor the same endpoint + sort form.
    const sort = section.id === "popular" ? "rating" : "date";
    const { $, hasNextPage } = await this.fetchListing(page, sort);

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("#dle-content > .readed").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
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

    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async fetchListing(
    page: number,
    sort: string,
  ): Promise<{ $: CheerioAPI; hasNextPage: boolean }> {
    let path = "/comix";
    if (page > 1) path += `/page/${page}`;
    path += "/";
    const url = `${BASE_URL}${path}`;

    const body = [
      `dlenewssortby=${encodeURIComponent(sort)}`,
      "dledirection=desc",
      "set_new_sort=dle_sort_cat_1",
      "set_direction_sort=dle_direction_cat_1",
    ].join("&");

    const $ = await this.fetchCheerio({
      url,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const lastChild = $("div.pagination__pages").children().last();
    const hasNextPage = lastChild.length > 0 && lastChild.prop("tagName")
      ? String(lastChild.prop("tagName")).toLowerCase() === "a"
      : false;

    return { $, hasNextPage };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaBayMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    // Direct manga URL paste support.
    if (/^https?:\/\//i.test(titleQuery)) {
      const path = titleQuery.replace(/^https?:\/\/[^/]+/, "");
      if (/^\/\d+-[^/]+\.html$/.test(path)) {
        const mangaId = this.parsePath(path);
        const $ = await this.fetchCheerio({
          url: this.mangaUrl(mangaId),
          method: "GET",
        });
        const title =
          $("article.page header.page__header h1").first().text().trim() ||
          this.safeDecode(mangaId);
        const imageUrl = this.imageFromElement(
          $("div.page__poster img").first(),
          "src",
        );
        return {
          items: [{ mangaId, imageUrl, title, subtitle: undefined, metadata: undefined }],
          metadata: undefined,
        };
      }
      throw new Error("Not a manga URL");
    }

    if (titleQuery !== "") {
      let path = `/search/${encodeURIComponent(titleQuery)}`;
      if (page > 1) path += `/page/${page}`;
      path += "/";
      const url = `${BASE_URL}${path}`;
      const $ = await this.fetchCheerio({ url, method: "GET" });
      return this.parseSearch($, page);
    }

    // Empty query -> browse the catalogue (default sort).
    const { $, hasNextPage } = await this.fetchListing(page, "");
    const results: SearchResultItem[] = [];
    $("#dle-content > .readed").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private parseSearch(
    $: CheerioAPI,
    page: number,
  ): PagedResults<SearchResultItem> {
    const results: SearchResultItem[] = [];
    $("#dle-content > .readed").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const lastChild = $("div.pagination__pages").children().last();
    const hasNextPage =
      lastChild.length > 0 && lastChild.prop("tagName")
        ? String(lastChild.prop("tagName")).toLowerCase() === "a"
        : false;

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find(".readed__title > a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = link.text().trim();
    const imageUrl = this.imageFromElement(
      el.find(".readed__img img").first(),
      "data-src",
    );
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
      $("article.page header.page__header h1").first().text().trim() ||
      this.safeDecode(mangaId);
    const thumbnailUrl = this.imageFromElement(
      $("div.page__poster img").first(),
      "src",
    );

    const altTitles = ($("article.page header.page__header > h2").first().text() || "")
      .split(/\s*[;,/]\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const synopsis = $("div.page__text").first().text().trim();

    const author = this.ownText(
      $(".page__list > li:has(> div:contains(Author))").first(),
    );
    const artist = this.ownText(
      $(".page__list > li:has(> div:contains(Artist))").first(),
    );

    let typePill = "";
    $("div.page__meta-pills > span.page__meta-pill").each((_, el) => {
      if (typePill) return;
      const $el = $(el);
      if (!$el.hasClass("page__meta-pill--status")) {
        typePill = $el.text().trim();
      }
    });
    const type = this.mapType(typePill);

    const tagGenres = $("div.page__tags > a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0)
      .map((g) => g.charAt(0).toUpperCase() + g.slice(1));

    const allTags = [...(type ? [type] : []), ...tagGenres];
    const tagGroups: TagSection[] = [];
    if (allTags.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: allTags.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    const statusText = $("span.page__meta-pill--status").first().text();

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altTitles,
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

    const raw = this.extractData($);
    if (!raw) return [];

    let data: ChapterListDtoJson;
    try {
      data = JSON.parse(raw) as ChapterListDtoJson;
    } catch {
      return [];
    }
    if (!data || !Array.isArray(data.chapters)) return [];

    const newsId = data.news_id;
    const chapters: Chapter[] = [];
    data.chapters.forEach((ch, index) => {
      const chapterId = this.toSafeId(`reader/${newsId}/${ch.id}`);
      chapters.push({
        chapterId,
        sourceManga,
        title: ch.title,
        volume: 0,
        chapNum: this.parseChapterNumber(ch.title, data.chapters.length - index),
        publishDate: this.parseDate(ch.date),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const raw = this.extractData($);
    const pages: string[] = [];
    if (raw) {
      try {
        const data = JSON.parse(raw) as PageListDtoJson;
        if (data && Array.isArray(data.images)) {
          for (const img of data.images) {
            const trimmed = (img || "").trim();
            if (!trimmed) continue;
            pages.push(
              trimmed.startsWith("http") ? trimmed : `${BASE_URL}${trimmed}`,
            );
          }
        }
      } catch {
        // fall through to empty pages
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

  private extractData($: CheerioAPI): string | undefined {
    let script = "";
    $("script").each((_, el) => {
      if (script) return;
      const content = $(el).html() || "";
      if (content.includes("window.__DATA__")) {
        script = content;
      }
    });
    if (!script) return undefined;
    const after = script.split("window.__DATA__ = ")[1];
    if (after === undefined) return undefined;
    let value = after.split(";window.")[0].trim();
    value = value.replace(/;$/, "").trim();
    return value || undefined;
  }

  private ownText(el: Cheerio<AnyNode>): string {
    // own text only (excluding child element text), mimics jsoup ownText().
    const node = el.get(0);
    if (!node) return "";
    const parts: string[] = [];
    for (const child of (node as { children?: AnyNode[] }).children ?? []) {
      if ((child as { type?: string }).type === "text") {
        parts.push((child as { data?: string }).data ?? "");
      }
    }
    return parts.join("").trim();
  }

  private mapType(t: string): string {
    switch (t.toLowerCase()) {
      case "korean":
        return "Manhwa";
      case "chinese":
        return "Manhua";
      case "japanese":
        return "Manga";
      default:
        return t;
    }
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

  private parseChapterNumber(name: string, fallback: number): number {
    const m = (name || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  private parseDate(date: string | undefined): Date {
    const s = (date || "").trim();
    // upstream format: d.M.yyyy
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const year = parseInt(m[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date(0);
  }

  private imageFromElement(img: Cheerio<AnyNode>, primary: string): string {
    const src =
      img.attr(primary) ||
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
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed") || s.includes("finished")) return "Completed";
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

export const MangaBay = new MangaBayExtension();
