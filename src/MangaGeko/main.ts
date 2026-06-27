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
  Form,
  MangaProviding,
  Metadata,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SettingsFormProviding,
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { getHideNsfw, MangaGekoSettingsForm } from "./settings";
import { MangaGekoSearchForm, MangaGekoSearchMeta } from "./forms";

const BASE_URL = "https://www.mgeko.cc";

interface MangaGekoMetadata {
  page?: number;
}

interface BrowseDto {
  results_html?: string;
  page?: number;
  num_pages?: number;
}

class MangaGekoInterceptor extends PaperbackInterceptor {
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

type MangaGekoImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaGekoExtension implements MangaGekoImplementation {
  requestManager = new MangaGekoInterceptor("main");
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

  async getSettingsForm(): Promise<Form> {
    return new MangaGekoSettingsForm();
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
      | { searchMeta?: MangaGekoSearchMeta }
      | undefined;
    return new MangaGekoSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaGekoMetadata | undefined;
    const page = meta?.page ?? 1;

    const sort = section.id === "popular" ? "popular_all_time" : "latest";
    const safeMode = getHideNsfw() ? "1" : "0";
    const url = `${BASE_URL}/browse-comics/data/?page=${page}&sort=${sort}&safe_mode=${safeMode}`;

    const { mangas, hasNextPage } = await this.fetchBrowse(url);
    const itemType: DiscoverSectionItem["type"] =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";

    const items: DiscoverSectionItem[] = mangas.map((m) => ({
      type: itemType,
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaGekoMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangaGekoSearchMeta } | undefined
    )?.searchMeta;

    const hasFilters = this.hasActiveFilters(searchMeta);

    // Text-only search uses the /search/ autocomplete page (HTML, .novel-item).
    if (titleQuery && !hasFilters) {
      const url = `${BASE_URL}/search/?search=${encodeURIComponent(
        titleQuery,
      )}&results=${page}`;
      const $ = await this.fetchCheerio({ url, method: "GET" });
      const results: SearchResultItem[] = [];
      $(".novel-item").each((_, element) => {
        const el = $(element);
        const title = el.find(".novel-title").first().text().trim();
        const href = el.find("a").first().attr("href") || "";
        if (!title || !href) return;
        const imageUrl = this.imageFromElement(el.find(".novel-cover img"));
        results.push({
          mangaId: this.parsePath(href),
          imageUrl,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      });
      const hasNextPage = $("nav.paging a:contains(Next)").length > 0;
      return {
        items: results,
        metadata: hasNextPage ? { page: page + 1 } : undefined,
      };
    }

    // Filter / advanced browse uses the browse-comics JSON endpoint.
    const url = this.buildBrowseUrl(titleQuery, searchMeta, page);
    const { mangas, hasNextPage } = await this.fetchBrowse(url);
    const results: SearchResultItem[] = mangas.map((m) => ({
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private hasActiveFilters(meta: MangaGekoSearchMeta | undefined): boolean {
    if (!meta) return false;
    return (
      (meta.sort?.length ?? 0) > 0 ||
      (meta.status?.[0] ?? "") !== "" ||
      (meta.type?.[0] ?? "") !== "" ||
      (meta.includeGenres?.length ?? 0) > 0 ||
      (meta.excludeGenres?.length ?? 0) > 0 ||
      (meta.extras?.length ?? 0) > 0 ||
      (meta.tags ?? "").trim() !== "" ||
      (meta.minChapters ?? "").trim() !== "" ||
      (meta.maxChapters ?? "").trim() !== "" ||
      (meta.minRating ?? "").trim() !== ""
    );
  }

  private buildBrowseUrl(
    titleQuery: string,
    meta: MangaGekoSearchMeta | undefined,
    page: number,
  ): string {
    const params: string[] = [];

    const sort = meta?.sort?.[0] ?? "latest";
    params.push(`sort=${encodeURIComponent(sort)}`);

    const status = meta?.status?.[0] ?? "";
    if (status) params.push(`status=${encodeURIComponent(status)}`);

    const type = meta?.type?.[0] ?? "";
    if (type) params.push(`type=${encodeURIComponent(type)}`);

    const minChapters = (meta?.minChapters ?? "").trim();
    if (minChapters)
      params.push(`min_chapters=${encodeURIComponent(minChapters)}`);

    const maxChapters = (meta?.maxChapters ?? "").trim();
    if (maxChapters)
      params.push(`max_chapters=${encodeURIComponent(maxChapters)}`);

    const minRating = (meta?.minRating ?? "").trim();
    const ratingValue = parseFloat(minRating);
    if (minRating && !isNaN(ratingValue)) {
      params.push(`min_rating=${Math.trunc(ratingValue * 10)}`);
    }

    for (const extra of meta?.extras ?? []) {
      params.push(`${encodeURIComponent(extra)}=1`);
    }

    params.push(`safe_mode=${getHideNsfw() ? "1" : "0"}`);
    params.push(`page=${page}`);

    const include = meta?.includeGenres ?? [];
    if (include.length > 0)
      params.push(`include_genres=${encodeURIComponent(include.join(","))}`);

    const exclude = meta?.excludeGenres ?? [];
    if (exclude.length > 0)
      params.push(`exclude_genres=${encodeURIComponent(exclude.join(","))}`);

    const tags = (meta?.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length > 0)
      params.push(`tags=${encodeURIComponent(tags.join(","))}`);

    params.push(`q=${encodeURIComponent(titleQuery)}`);

    return `${BASE_URL}/browse-comics/data/?${params.join("&")}`;
  }

  private async fetchBrowse(url: string): Promise<{
    mangas: { mangaId: string; title: string; imageUrl: string }[];
    hasNextPage: boolean;
  }> {
    const dto = await this.fetchJson<BrowseDto>({ url, method: "GET" });
    const html = dto.results_html ?? "";
    const dom = htmlparser2.parseDocument(html);
    const $ = cheerio.load(dom);

    const mangas: { mangaId: string; title: string; imageUrl: string }[] = [];
    $(".comic-card").each((_, element) => {
      const el = $(element);
      const title = el.find(".comic-card__title a").first().text().trim();
      const href = el.find("a").first().attr("href") || "";
      if (!title || !href) return;
      const imageUrl = this.imageFromElement(el.find(".comic-card__cover img"));
      mangas.push({ mangaId: this.parsePath(href), title, imageUrl });
    });

    const page = dto.page ?? 1;
    const numPages = dto.num_pages ?? page;
    return { mangas, hasNextPage: page < numPages };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const author = $(".author a").first().attr("title")?.trim();

    const summary = $(".description").first().text().trim();
    const summaryText = summary.includes("Summary is")
      ? summary.substring(summary.indexOf("Summary is") + "Summary is".length)
      : summary;

    let synopsis = summaryText.trim();
    const altRaw = $(".alternative-title").first().clone();
    altRaw.children().remove();
    const altText = altRaw.text().trim();
    if (altText) {
      const altNames = altText
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.toLowerCase() !== "updating");
      if (altNames.length > 0) {
        synopsis += `\n\nAlternative Name:`;
        for (const name of altNames) synopsis += `\n- ${name}`;
      }
    }

    const genres = $(".categories a[href*=genre]")
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

    let status = "Unknown";
    if ($("div.header-stats strong.completed").length > 0) status = "Completed";
    else if ($("div.header-stats strong.ongoing").length > 0)
      status = "Ongoing";

    const thumbnailUrl = this.imageFromElement($(".cover img"));

    const cleanAuthor =
      author && author.toLowerCase() !== "updating" ? author : undefined;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle:
          $(".novel-title").first().text().trim() ||
          $("h1").first().text().trim() ||
          this.safeDecode(mangaId),
        secondaryTitles: [],
        thumbnailUrl,
        author: cleanAuthor,
        synopsis: synopsis.trim(),
        contentRating: ContentRating.MATURE,
        status,
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const base = this.mangaUrl(sourceManga.mangaId).replace(/\/+$/, "");
    const url = `${base}/all-chapters/`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    $("ul.chapter-list > li").each((_, element) => {
      const el = $(element);
      const href = el.find("a").first().attr("href") || "";
      if (!href) return;
      const chapterName = el
        .find(".chapter-title, .chapter-number")
        .first()
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim()
        .replace(/-eng-li$/, "");
      const name = `Chapter ${chapterName}`;
      const dateText = el.find(".chapter-update").first().attr("datetime");

      chapters.push({
        chapterId: this.parsePath(href),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(chapterName),
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
    $("#chapter-reader img").each((_, element) => {
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

  private imageFromElement(el: Cheerio<AnyNode>): string {
    const dataSrc = el.first().attr("data-src") || "";
    const src = el.first().attr("src") || "";
    return this.absoluteUrl(dataSrc || src);
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
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
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
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    const cleaned = dateText.replace(/\./g, "").replace("Sept", "Sep");
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

export const MangaGeko = new MangaGekoExtension();
