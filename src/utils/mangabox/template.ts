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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, MangaBoxSettingsForm } from "./settings";

export interface MangaBoxConfig {
  name: string;
  baseUrl: string;
  mirrors?: string[];
  contentRating?: ContentRating;
  langCode?: string;
}

interface MangaBoxSearchMetadata {
  page?: number;
  collectedIds?: string[];
}

interface MangaBoxApiChapter {
  chapter_name?: string;
  chapter_num?: number;
  chapter_slug?: string;
  updated_at?: string;
}

interface MangaBoxApiResponse {
  data?: {
    chapters?: MangaBoxApiChapter[];
    pagination?: { hasMore?: boolean };
  };
}

class MangaBoxInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    const incoming = request.headers ?? {};
    // CF-critical headers (user-agent/referer/origin/accept-language) must be
    // forced LAST so they always match the Cloudflare clearance cookie -
    // letting a caller's user-agent win breaks the bypass. But the chapters
    // JSON API needs `accept: application/json` + `x-requested-with`, so seed
    // a default `accept` first and let the caller's accept/x-requested-with
    // override it before the CF headers are pinned.
    request.headers = {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ...incoming,
      referer: `${baseUrl}/`,
      origin: baseUrl,
      "user-agent": await Application.getDefaultUserAgent(),
      "accept-language": "en-US,en;q=0.5",
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
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

type MangaBoxImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaBoxExtension implements MangaBoxImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly mirrors: string[];
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MangaBoxInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MangaBoxConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.mirrors = config.mirrors ?? [];
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangaBoxInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaBoxSettingsForm(
      this.sourceName,
      this.defaultBaseUrl,
      this.mirrors,
    );
  }

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
        id: "popular_section",
        title: "Hot Manga",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest_section",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const listPath =
      section.id === "popular_section" ? "hot-manga" : "latest-manga";
    const url = new URLBuilder(this.baseUrl)
      .addPath("manga-list")
      .addPath(listPath)
      .addQuery("page", 1)
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    const itemType =
      section.id === "popular_section"
        ? "featuredCarouselItem"
        : "simpleCarouselItem";

    this.eachListItem($, (mangaId, title, image) => {
      if (title && mangaId && !seen.has(mangaId)) {
        seen.add(mangaId);
        items.push({
          type: itemType,
          mangaId,
          imageUrl: image,
          title,
          metadata: undefined,
        });
      }
    });

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaBoxSearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery) {
      url = new URLBuilder(this.baseUrl)
        .addPath("search")
        .addPath("story")
        .addPath(this.normalizeSearchQuery(titleQuery))
        .addQuery("page", page)
        .build();
    } else {
      url = new URLBuilder(this.baseUrl)
        .addPath("manga-list")
        .addPath("hot-manga")
        .addQuery("page", page)
        .build();
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>(collectedIds);

    this.eachListItem($, (mangaId, title, image) => {
      if (!title || !mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      results.push({
        mangaId,
        imageUrl: image,
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPageLink($);
    const reachedLimit = page >= MangaBoxExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedLimit
          ? { page: page + 1, collectedIds: [...seen] }
          : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.getMangaShareUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const info = $("div.manga-info-top, div.panel-story-info").first();
    const title = info.find("h1, h2").first().text().trim();
    const image = this.imageFromElement(
      $("div.manga-info-pic img, span.info-image img").first(),
    );

    // The info block lists facts as either `<li>Label : value</li>` (old
    // layout) or `<td>Label</td><td>value</td>` (table layout). jQuery
    // pseudo-classes (`:contains`, `:containsOwn`, `:has`) are NOT supported
    // by Paperback's CSS engine ("Unknown pseudo-class :containsown"), so
    // match the label text in JS instead.
    const author = this.infoRowLinks($, info, "author").join(", ");

    const statusText = this.infoRowText($, info, "status");

    const genres = this.infoRowLinks($, info, "genres");

    const description = $(
      "div#noidungm, div#panel-story-info-description, div#contentBox",
    )
      .first()
      .text()
      .trim();

    const altName = this.findAltName($)
      .replace(/alternative\s*:?/i, "")
      .trim();

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
        thumbnailUrl: image,
        author: author || undefined,
        synopsis: description,
        contentRating: this.contentRating,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters (JSON API with pagination)
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.slugFromMangaId(sourceManga.mangaId);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    // Try the JSON API first (fast, paginated).
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    let guard = 0;

    while (hasMore && guard < 50) {
      guard++;
      const url = new URLBuilder(this.baseUrl)
        .addPath("api")
        .addPath("manga")
        .addPath(slug)
        .addPath("chapters")
        .addQuery("limit", limit)
        .addQuery("offset", offset)
        .build();

      let json: MangaBoxApiResponse;
      try {
        json = await this.fetchJson<MangaBoxApiResponse>({
          url,
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            "x-requested-with": "XMLHttpRequest",
            referer: new URLBuilder(this.baseUrl)
              .addPath("manga")
              .addPath(slug)
              .build(),
          },
        });
      } catch {
        break;
      }

      const list = json.data?.chapters ?? [];
      for (const c of list) {
        const chapterSlug = c.chapter_slug ?? "";
        if (!chapterSlug) continue;
        const chapterId = this.toSafeId(`manga/${slug}/${chapterSlug}`);
        if (seen.has(chapterId)) continue;
        seen.add(chapterId);

        const name = c.chapter_name ?? `Chapter ${c.chapter_num ?? 0}`;
        chapters.push({
          chapterId,
          sourceManga,
          title: name,
          volume: 0,
          chapNum: c.chapter_num ?? 0,
          publishDate: this.parseDate(c.updated_at),
          langCode: this.langCode,
        });
      }

      hasMore = json.data?.pagination?.hasMore === true && list.length > 0;
      offset += limit;
    }

    // Fallback: if the API returned nothing (403/blocked), load the manga
    // page in a webview and scrape the chapter list after JS renders it.
    if (chapters.length === 0) {
      const webChapters = await this.getChaptersViaWebView(slug, sourceManga);
      return webChapters;
    }

    return chapters;
  }

  /**
   * When the chapters JSON API is blocked (403 from Cloudflare outside the
   * browser context), fetch it from within a webview where the CF clearance
   * cookie and challenge state are available.
   */
  private async getChaptersViaWebView(
    slug: string,
    sourceManga: SourceManga,
  ): Promise<Chapter[]> {
    const apiUrl = new URLBuilder(this.baseUrl)
      .addPath("api")
      .addPath("manga")
      .addPath(slug)
      .addPath("chapters")
      .addQuery("limit", 2000)
      .addQuery("offset", 0)
      .build();

    const inject = `
      fetch(${JSON.stringify(apiUrl)}, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
      .then(function(r) { return r.text(); })
      .then(function(t) {
        window.webkit.messageHandlers.Paperback.postMessage(t);
      })
      .catch(function(e) {
        window.webkit.messageHandlers.Paperback.postMessage(JSON.stringify({error: e.message}));
      });
    `;

    try {
      const result = await Application.executeInWebView({
        source: {
          html: "<html><head></head><body></body></html>",
          baseUrl: this.baseUrl,
          loadCSS: false,
          loadImages: false,
        },
        inject,
        storage: { cookies: [] },
      });

      const json = JSON.parse(String(result.result)) as MangaBoxApiResponse;
      const list = json.data?.chapters ?? [];
      const chapters: Chapter[] = [];
      const seen = new Set<string>();

      for (const c of list) {
        const chapterSlug = c.chapter_slug ?? "";
        if (!chapterSlug) continue;
        const chapterId = this.toSafeId(`manga/${slug}/${chapterSlug}`);
        if (seen.has(chapterId)) continue;
        seen.add(chapterId);

        const name = c.chapter_name ?? `Chapter ${c.chapter_num ?? 0}`;
        chapters.push({
          chapterId,
          sourceManga,
          title: name,
          volume: 0,
          chapNum: c.chapter_num ?? 0,
          publishDate: this.parseDate(c.updated_at),
          langCode: this.langCode,
        });
      }
      return chapters;
    } catch {
      return [];
    }
  }

  private parseChapterNum(title: string): number {
    const m = title.match(/(?:chapter|ch)[.\s-]*(\d+(?:\.\d+)?)/i);
    return m ? parseFloat(m[1]) : -1;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.safeDecode(chapter.chapterId))
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    // Preferred: cdns=[...] and chapterImages=[...] in a script tag.
    $("script").each((_, el) => {
      const html = $(el).html() || "";
      if (!html.includes("cdns")) return;
      const cdnsMatch = html.match(/cdns\s*=\s*(\[[^\]]*\])/);
      const imagesMatch = html.match(/chapterImages\s*=\s*(\[[^\]]*\])/);
      if (!cdnsMatch || !imagesMatch) return;
      let cdns: string[] = [];
      let images: string[] = [];
      try {
        cdns = JSON.parse(cdnsMatch[1]);
        images = JSON.parse(imagesMatch[1]);
      } catch {
        return;
      }
      const cdn = cdns[0] || "";
      for (const img of images) {
        if (typeof img !== "string") continue;
        if (img.startsWith("http")) {
          pages.push(img);
        } else if (cdn) {
          pages.push(`${cdn}/${img}`);
        }
      }
    });

    // Fallback: plain image elements.
    if (pages.length === 0) {
      $("div.container-chapter-reader > img").each((_, el) => {
        const image = this.imageFromElement($(el));
        if (image) pages.push(image);
      });
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: [...new Set(pages)],
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return new URLBuilder(this.baseUrl)
      .addPath(this.safeDecode(mangaId))
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Find an info row by its label (e.g. "author", "status", "genres") and
   * return the text of each anchor inside it. Handles both the `<li>Label :
   * <a>value</a></li>` layout and the `<td>Label</td><td><a>value</a></td>`
   * table layout, matching the label in JS (Paperback's CSS engine rejects
   * `:contains`/`:containsOwn`).
   */
  private infoRowLinks(
    $: CheerioAPI,
    info: Cheerio<Element>,
    label: string,
  ): string[] {
    const out: string[] = [];
    const want = label.toLowerCase();
    info.find("li").each((_, el) => {
      const row = $(el);
      if (row.text().toLowerCase().includes(want)) {
        row.find("a").each((__, a) => {
          const t = $(a).text().trim();
          if (t) out.push(t);
        });
      }
    });
    if (out.length === 0) {
      info.find("td").each((_, el) => {
        const cell = $(el);
        if (cell.text().trim().toLowerCase().startsWith(want)) {
          const next = cell.next("td");
          const anchors = next.find("a");
          if (anchors.length > 0) {
            anchors.each((__, a) => {
              const t = $(a).text().trim();
              if (t) out.push(t);
            });
          } else {
            const t = next.text().trim();
            if (t) out.push(t);
          }
        }
      });
    }
    return out.filter((s) => s.length > 0);
  }

  /** Like infoRowLinks but returns the row's plain text value (no anchors). */
  private infoRowText(
    $: CheerioAPI,
    info: Cheerio<Element>,
    label: string,
  ): string {
    const want = label.toLowerCase();
    let value = "";
    info.find("li").each((_, el) => {
      if (value) return;
      const row = $(el);
      const text = row.text().trim();
      if (text.toLowerCase().includes(want)) {
        value = text.replace(new RegExp(`^[^:]*${want}[^:]*:?\\s*`, "i"), "").trim() || text;
      }
    });
    if (!value) {
      info.find("td").each((_, el) => {
        if (value) return;
        const cell = $(el);
        if (cell.text().trim().toLowerCase().startsWith(want)) {
          value = cell.next("td").text().trim();
        }
      });
    }
    return value;
  }

  /** Find the alternative-title text without using `:has()`. */
  private findAltName($: CheerioAPI): string {
    const direct = $(".story-alternative").first().text().trim();
    if (direct) return direct;
    let alt = "";
    $("tr").each((_, el) => {
      if (alt) return;
      const row = $(el);
      if (row.find(".info-alternative").length > 0) {
        alt = row.find("h2").first().text().trim();
      }
    });
    return alt;
  }

  /** Detect a "next page" pagination link without `:contains()`. */
  private hasNextPageLink($: CheerioAPI): boolean {
    let found = false;
    $(
      "div.group_page a, div.group-page a, a.page_select + a, a.page-select + a",
    ).each((_, el) => {
      if (found) return;
      const a = $(el);
      const text = a.text().trim().toLowerCase();
      const cls = (a.attr("class") || "").toLowerCase();
      // A usable "next" link points to another page and is not the
      // first/last/selected control.
      if (cls.includes("page_last") || cls.includes("page-last")) return;
      if (text === "last" || text.includes("last")) return;
      if (a.attr("href")) found = true;
    });
    return found;
  }

  private eachListItem(
    $: CheerioAPI,
    cb: (mangaId: string, title: string, image: string) => void,
  ): void {
    $(
      "div.truyen-list > div.list-truyen-item-wrap, div.comic-list > .list-comic-item-wrap, .panel_story_list .story_item, div.list-truyen-item-wrap, div.list-comic-item-wrap",
    ).each((_, element) => {
      const unit = $(element);
      const link = unit.find("h3 a").first();
      const anchor = link.length > 0 ? link : unit.find("a").first();
      const href = (anchor.attr("href") || "").trim();
      // Skip injected advertisements: they sit in the same list-item wrappers
      // but link off-site (e.g. bit.ly) and open in a new tab
      // (target="_blank"/rel="sponsored"). Real entries link to an on-site
      // manga path on the source's own host.
      if (this.isExternalOrAdLink(href, anchor.attr("target"), anchor.attr("rel"))) {
        return;
      }
      const title = (link.text() || unit.find("a").first().attr("title") || "")
        .trim();
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());
      cb(mangaId, title, image);
    });
  }

  /**
   * True when a list-item link is an injected ad rather than a manga entry:
   * an off-site host, a `target="_blank"` pop-out, or a sponsored `rel`.
   */
  private isExternalOrAdLink(
    href: string,
    target: string | undefined,
    rel: string | undefined,
  ): boolean {
    if (!href) return true;
    if (target && target.toLowerCase() === "_blank") return true;
    if (rel && /sponsored|nofollow/i.test(rel)) return true;
    if (/^https?:\/\//i.test(href)) {
      const hostMatch = href.match(/^https?:\/\/([^/]+)/i);
      const linkHost = (hostMatch?.[1] ?? "").toLowerCase();
      const baseHost = this.baseUrl
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .toLowerCase();
      // Compare registrable host loosely (ignore leading "www.").
      const strip = (h: string) => h.replace(/^www\./, "");
      if (linkHost && strip(linkHost) !== strip(baseHost)) return true;
    }
    return false;
  }


  private normalizeSearchQuery(query: string): string {
    return query
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_|_$/g, "");
  }

  private slugFromMangaId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const parts = decoded.split("/").filter((p) => p.length > 0);
    return parts[parts.length - 1] ?? decoded;
  }

  private parseMangaId(href: string): string {
    let cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    cleaned = cleaned.replace(/^\/+/, "");
    return this.toSafeId(cleaned);
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

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    let src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    src = src.trim();
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }

  private parseStatus(status: string): string {
    const s = status.toLowerCase().trim();
    if (!s) return "Unknown";
    if (s.includes("complet")) return "Completed";
    if (s.includes("ongoing") || s.includes("on going")) return "Ongoing";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
    return "Unknown";
  }

  private parseDate(dateText?: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
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

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}
