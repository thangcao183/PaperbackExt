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

const BASE_URL = "https://onlythebesthentai.com";

const TITLE_CLEANUP_REGEX = /\s*\[\d+]\s*$/;
const NON_DIGIT_REGEX = /[^0-9]/g;
const TIMEZONE_COLON_REGEX = /([+-]\d{2}):(\d{2})$/;
const WHITESPACE_REGEX = /\s+/;

interface OnlyTheBestHentaiMetadata {
  page?: number;
}

interface TaxonomyMetadata {
  taxonomy?: string;
  slug?: string;
}

class OnlyTheBestHentaiInterceptor extends PaperbackInterceptor {
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

type OnlyTheBestHentaiImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class OnlyTheBestHentaiExtension
  implements OnlyTheBestHentaiImplementation
{
  requestManager = new OnlyTheBestHentaiInterceptor("main");
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
        title: "Latest",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "tags",
        title: "Tags",
        type: DiscoverSectionType.genres,
      },
      {
        id: "parody",
        title: "Parodies",
        type: DiscoverSectionType.genres,
      },
      {
        id: "characters",
        title: "Characters",
        type: DiscoverSectionType.genres,
      },
      {
        id: "artist",
        title: "Artists",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (
      section.id === "tags" ||
      section.id === "parody" ||
      section.id === "characters" ||
      section.id === "artist"
    ) {
      return this.getTaxonomyItems(section.id);
    }

    const meta = metadata as OnlyTheBestHentaiMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = `${BASE_URL}/${page > 1 ? `page/${page}/` : ""}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("article.post").each((_, element) => {
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

    const hasNextPage = $("a.next.page-numbers").length > 0;
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async getTaxonomyItems(
    taxonomy: string,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // WordPress REST taxonomy endpoints used by the upstream source.
    const restPath =
      taxonomy === "parody"
        ? "categories"
        : taxonomy === "tags"
          ? "tags"
          : taxonomy;
    const entries = await this.fetchTaxonomy(restPath);

    const items: DiscoverSectionItem[] = entries.map((entry) => ({
      type: "genresCarouselItem",
      name: entry.count > 0 ? `${entry.name} (${entry.count})` : entry.name,
      searchQuery: {
        title: "",
        metadata: { taxonomy, slug: entry.slug } as Metadata,
      },
      metadata: undefined,
    }));

    return { items, metadata: undefined };
  }

  private async fetchTaxonomy(
    restPath: string,
  ): Promise<{ name: string; slug: string; count: number }[]> {
    const result: { name: string; slug: string; count: number }[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = `${BASE_URL}/wp-json/wp/v2/${restPath}?per_page=100&page=${page}`;
      const [response, data] = await Application.scheduleRequest({
        url,
        method: "GET",
      });
      if (response.status >= 400) break;

      if (page === 1) {
        const headerValue = response.headers?.["x-wp-totalpages"];
        const parsed = headerValue ? parseInt(headerValue, 10) : NaN;
        totalPages = Number.isNaN(parsed) ? 1 : parsed;
      }

      try {
        const json = JSON.parse(Application.arrayBufferToUTF8String(data));
        if (Array.isArray(json)) {
          for (const item of json) {
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              const name = typeof obj.name === "string" ? obj.name : "";
              const slug = typeof obj.slug === "string" ? obj.slug : "";
              const count = typeof obj.count === "number" ? obj.count : 0;
              if (name && slug) result.push({ name, slug, count });
            }
          }
        }
      } catch {
        break;
      }
      page++;
    } while (page <= totalPages);

    return result.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as OnlyTheBestHentaiMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery) {
      const params: string[] = [`s=${encodeURIComponent(titleQuery)}`];
      if (page > 1) params.push(`paged=${page}`);
      url = `${BASE_URL}/?${params.join("&")}`;
    } else {
      const tax = query.metadata as TaxonomyMetadata | undefined;
      const taxonomy = tax?.taxonomy;
      const slug = tax?.slug;
      let base = `${BASE_URL}/`;
      if (taxonomy && slug) {
        const segment =
          taxonomy === "tags"
            ? "tag"
            : taxonomy === "parody"
              ? "parody"
              : taxonomy === "characters"
                ? "characters"
                : taxonomy === "artist"
                  ? "artist"
                  : taxonomy;
        base = `${BASE_URL}/${segment}/${slug}/`;
      }
      url = `${base}${page > 1 ? `page/${page}/` : ""}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("article.post").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
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

    const hasNextPage = $("a.next.page-numbers").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find(".blog-entry-title a, .entry-title a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = link.text().replace(TITLE_CLEANUP_REGEX, "").trim();
    const imageUrl = this.imageFromElement(
      el.find(".nv-post-thumbnail-wrap img").first(),
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
      $("h1.manga-title").first().text().trim() || this.safeDecode(mangaId);
    const thumbnailUrl = this.imageFromElement(
      $(".manga-box .manga-img img").first(),
    );

    const tags = this.tagButtonTexts($, "Tags");
    const artists = this.tagButtonTexts($, "Artist");
    const parodies = this.tagButtonTexts($, "Parody");
    const characters = this.tagButtonTexts($, "Characters");

    const tagGroups: TagSection[] = [];
    if (tags.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: tags.map((t) => ({
          id: t.toLowerCase().replace(/\s+/g, "-"),
          title: t,
        })),
      });
    }

    const synopsis = this.buildDescription($, parodies, characters);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author: artists.join(", ") || undefined,
        artist: artists.join(", ") || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: "Completed",
        tagGroups,
        shareUrl: url,
      },
    };
  }

  private tagButtonTexts($: CheerioAPI, label: string): string[] {
    const out: string[] = [];
    $(".manga-tags-container").each((_, container) => {
      const el = $(container);
      const labelText = el.find(".manga-tags-label").first().text();
      if (!labelText.includes(label)) return;
      el.find(".tag-button").each((__, btn) => {
        const text = $(btn).text().trim();
        if (text) out.push(text);
      });
    });
    return out;
  }

  private buildDescription(
    $: CheerioAPI,
    parodies: string[],
    characters: string[],
  ): string {
    const lines: string[] = [];
    if (parodies.length > 0) lines.push(`Parody: ${parodies.join(", ")}`);
    if (characters.length > 0)
      lines.push(`Characters: ${characters.join(", ")}`);

    let pages = "";
    $(".manga-tags-container").each((_, container) => {
      if (pages) return;
      const el = $(container);
      const labelText = el.find(".manga-tags-label").first().text();
      if (!labelText.startsWith("Pages")) return;
      pages = el.text().replace(NON_DIGIT_REGEX, "");
    });
    if (pages) lines.push(`Pages: ${pages}`);

    const body = $(".manga-info p")
      .first()
      .text()
      .replace(/^Description:/, "")
      .trim();

    let result = lines.join("\n");
    if (body) {
      if (result) result += "\n\n";
      result += body;
    }
    return result.trim();
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    let pageCount: number | undefined;
    $(".manga-tags-container").each((_, container) => {
      if (pageCount !== undefined) return;
      const el = $(container);
      const labelText = el.find(".manga-tags-label").first().text();
      if (!labelText.startsWith("Pages")) return;
      const parsed = parseInt(el.text().replace(NON_DIGIT_REGEX, ""), 10);
      if (!Number.isNaN(parsed)) pageCount = parsed;
    });

    const rawDate = (
      $("meta[property='article:published_time']").first().attr("content") || ""
    ).replace(TIMEZONE_COLON_REGEX, "$1$2");

    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title:
          pageCount !== undefined
            ? `Chapter [${pageCount} pages]`
            : "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate: this.parseDate(rawDate),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $(".manga-gallery-wrapper figure.wp-block-image img").each(
      (_, element) => {
        const src = this.bestImageUrl($, $(element));
        if (src) pages.push(src);
      },
    );

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  private bestImageUrl($: CheerioAPI, img: Cheerio<AnyNode>): string {
    const srcset = (img.attr("srcset") || "").trim();
    if (srcset) {
      let bestUrl = "";
      let bestWidth = -1;
      for (const entry of srcset.split(",")) {
        const parts = entry.trim().split(WHITESPACE_REGEX);
        if (parts.length === 0 || !parts[0]) continue;
        const widthToken = parts[parts.length - 1];
        const width = parseInt(widthToken.replace(/w$/, ""), 10);
        const w = Number.isNaN(width) ? 0 : width;
        if (w >= bestWidth) {
          bestWidth = w;
          bestUrl = parts[0];
        }
      }
      if (bestUrl) return this.absoluteUrl(bestUrl);
    }
    return this.imageFromElement(img);
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

  private parseDate(raw: string): Date {
    const s = (raw || "").trim();
    if (!s) return new Date(0);
    const ts = Date.parse(s);
    return Number.isNaN(ts) ? new Date(0) : new Date(ts);
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

export const OnlyTheBestHentai = new OnlyTheBestHentaiExtension();
