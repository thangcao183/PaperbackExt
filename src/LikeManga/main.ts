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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { LikeMangaSearchForm, LikeMangaSearchMeta } from "./forms";

const BASE_URL = "https://likemanga.ink";

interface LikeMangaMetadata {
  page?: number;
}

class LikeMangaInterceptor extends PaperbackInterceptor {
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

type LikeMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class LikeMangaExtension implements LikeMangaImplementation {
  requestManager = new LikeMangaInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 2,
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
        id: "top-manga",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "lastest-chap",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "top-month",
        title: "Top This Month",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: LikeMangaSearchMeta }
      | undefined;
    return new LikeMangaSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as LikeMangaMetadata | undefined;
    const page = meta?.page ?? 1;

    const url = this.buildSearchUrl({ sortBy: section.id, page });
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    $("div.card-body div.card").each((_, element) => {
      const unit = $(element);
      const link = unit.find("a").first();
      const href = link.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const title = unit.find(".title-manga").text().trim();
      const image = this.imageFromElement(unit.find("img").first());

      if (mangaId && title) {
        items.push({
          type:
            section.id === "top-manga"
              ? "featuredCarouselItem"
              : "simpleCarouselItem",
          mangaId,
          imageUrl: image,
          title,
          metadata: undefined,
        });
      }
    });

    const hasNextPage =
      $("ul.pagination a:contains(»)").length > 0;

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
    const meta = metadata as LikeMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const searchMeta = (
      query.metadata as { searchMeta?: LikeMangaSearchMeta } | undefined
    )?.searchMeta;

    const url = this.buildSearchUrl({
      keyword: titleQuery,
      page,
      sortBy: searchMeta?.sortBy?.[0],
      status: searchMeta?.status?.[0],
    });
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    $("div.card-body div.card").each((_, element) => {
      const unit = $(element);
      const link = unit.find("a").first();
      const href = link.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const title = unit.find(".title-manga").text().trim();
      const image = this.imageFromElement(unit.find("img").first());

      if (mangaId && title) {
        results.push({
          mangaId,
          imageUrl: image,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = $("ul.pagination a:contains(»)").length > 0;

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(opts: {
    keyword?: string;
    sortBy?: string;
    status?: string;
    page?: number;
  }): string {
    const params: string[] = ["act=searchadvance"];
    if (opts.sortBy) {
      params.push(`f[sortby]=${encodeURIComponent(opts.sortBy)}`);
    }
    if (opts.status) {
      params.push(`f[status]=${encodeURIComponent(opts.status)}`);
    }
    if (opts.keyword) {
      params.push(`f[keyword]=${encodeURIComponent(opts.keyword)}`);
    }
    if (opts.page && opts.page > 1) {
      params.push(`pageNum=${opts.page}`);
    }
    return `${BASE_URL}/?${params.join("&")}`;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = `${BASE_URL}/${mangaId}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("#title-detail-manga").text().trim();
    const image = this.imageFromElement($(".detail-info img").first());
    const description = $("#summary_shortened").first().text().trim();

    const genres: string[] = [];
    $(".list-info a[href*=/genres/]").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const statusText = $(".list-info .status p:nth-child(2)").first().text();
    let author = $(".list-info .author p:nth-child(2)").first().text().trim();
    if (author === "Updating") author = "";

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
        thumbnailUrl: image,
        author: author || undefined,
        synopsis: description,
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
    const mangaId = sourceManga.mangaId;
    const url = `${BASE_URL}/${mangaId}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    this.collectChapters($, $.root(), sourceManga, chapters, seen);

    // The detail page only shows the first page of chapters. Additional
    // pages are loaded via the AJAX endpoint.
    const lastPageOnclick = $("div.chapters_pagination a:not(.next)")
      .last()
      .attr("onclick");
    const lastPageMatch = lastPageOnclick?.match(/load_list_chapter\((\d+)\)/);
    const lastPage = lastPageMatch ? parseInt(lastPageMatch[1]) : 1;

    const dataMangaId = $("#title-detail-manga").attr("data-manga");
    const id = dataMangaId ? parseInt(dataMangaId) : NaN;

    if (!isNaN(id) && lastPage > 1) {
      for (let page = 2; page <= lastPage; page++) {
        try {
          const ajaxChapters = await this.fetchAjaxChapters(
            id,
            page,
            sourceManga,
            seen,
          );
          chapters.push(...ajaxChapters);
        } catch {
          // ignore failed page fetches
        }
      }
    }

    return chapters;
  }

  private collectChapters(
    $: CheerioAPI,
    root: Cheerio<Element> | ReturnType<CheerioAPI["root"]>,
    sourceManga: SourceManga,
    chapters: Chapter[],
    seen: Set<string>,
  ): void {
    $(".wp-manga-chapter", root as never).each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parseChapterId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find("a").text().trim();
      const chapNum = this.parseChapterNumber(name, chapterId);
      const dateText = el.find(".chapter-release-date").text().trim();

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum,
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });
  }

  private async fetchAjaxChapters(
    id: number,
    page: number,
    sourceManga: SourceManga,
    seen: Set<string>,
  ): Promise<Chapter[]> {
    const params = [
      "act=ajax",
      "code=load_list_chapter",
      `manga_id=${id}`,
      `page_num=${page}`,
      "chap_id=0",
      "keyword=",
    ];
    const url = `${BASE_URL}/?${params.join("&")}`;

    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status !== 200) return [];

    const jsonStr = Application.arrayBufferToUTF8String(data);
    const parsed = JSON.parse(jsonStr);
    const htmlString: string = parsed["list_chap"] ?? "";
    if (!htmlString) return [];

    const dom = htmlparser2.parseDocument(htmlString);
    const $ = cheerio.load(dom);

    const chapters: Chapter[] = [];
    $(".wp-manga-chapter").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parseChapterId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find("a").text().trim();
      const chapNum = this.parseChapterNumber(name, chapterId);
      const dateText = el.find(".chapter-release-date").text().trim();

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum,
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${BASE_URL}/${chapter.chapterId}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];

    // Newer pages embed an encrypted token containing the image list.
    const tokenInput = $("div.reading input#next_img_token");
    if (tokenInput.length > 0) {
      const cdnUrl = $("div.reading #currentlink").attr("value") || "";
      const tokenValue = tokenInput.attr("value") || "";
      const tokenParts = tokenValue.split(".");

      if (cdnUrl && tokenParts.length > 1) {
        try {
          const payload = this.base64ToString(tokenParts[1]);
          const jsonData = JSON.parse(payload);
          const encodedImgArray: string = jsonData["data"];
          const imgArrayStr = this.base64ToString(encodedImgArray);
          const imgArray = JSON.parse(imgArrayStr) as string[];
          for (const img of imgArray) {
            pages.push(`${cdnUrl}/${img}`);
          }
        } catch {
          // fall through to plain parsing
        }
      }
    }

    if (pages.length === 0) {
      $("div.reading-detail.box_doc img:not(noscript img)").each(
        (_, element) => {
          const image = this.imageFromElement($(element));
          if (image) pages.push(image);
        },
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE_URL}/${mangaId}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseMangaId(href: string): string {
    // Manga URLs are at the site root, e.g. https://likemanga.ink/{slug}
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
  }

  private parseChapterId(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
  // Slugs can contain decoded HTML entities such as apostrophes (from
  // `&#39;`), so percent-encode any disallowed character. The encoded ID
  // round-trips correctly when interpolated back into a request URL.
  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return (
        "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
      );
    });
  }

  private parseChapterNumber(name: string, chapterId: string): number {
    const numMatch = name.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
    if (numMatch) return parseFloat(numMatch[1]);
    const slugMatch = chapterId.match(/chapter-(\d+(?:[.-]\d+)?)/i);
    if (slugMatch) return parseFloat(slugMatch[1].replace("-", "."));
    return 0;
  }

  private base64ToString(value: string): string {
    const decoded = Application.base64Decode(value);
    if (typeof decoded === "string") return decoded;
    return Application.arrayBufferToUTF8String(decoded);
  }

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-cfsrc") ||
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      "";

    if (!src) {
      const srcset = img.attr("srcset");
      if (srcset) src = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
    }

    if (!src) src = img.attr("src") || "";

    src = src.trim();
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/") ? `${BASE_URL}${src}` : `${BASE_URL}/${src}`;
    }
    return src;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("complete")) return "Completed";
    if (s.includes("in process")) return "Ongoing";
    if (s.includes("pause")) return "Hiatus";
    return "Unknown";
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
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

export const LikeManga = new LikeMangaExtension();
