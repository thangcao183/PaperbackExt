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

const BASE_URL = "https://manhwazone.com";

interface ManhwaZoneMetadata {
  page?: number;
}

interface SearchMeta {
  sortBy?: string;
  status?: string;
  genres?: string[];
}

// Genre slugs mirrored from upstream Filters.kt
const GENRES: { title: string; slug: string }[] = [
  { title: "Action", slug: "action" },
  { title: "Adventure", slug: "adventure" },
  { title: "Avant Garde", slug: "avant-garde" },
  { title: "Award Winning", slug: "award-winning" },
  { title: "Boys Love", slug: "boys-love" },
  { title: "Comedy", slug: "comedy" },
  { title: "Drama", slug: "drama" },
  { title: "Fantasy", slug: "fantasy" },
  { title: "Girls Love", slug: "girls-love" },
  { title: "Gourmet", slug: "gourmet" },
  { title: "Horror", slug: "horror" },
  { title: "Mystery", slug: "mystery" },
  { title: "Romance", slug: "romance" },
  { title: "Sci-Fi", slug: "sci-fi" },
  { title: "Slice of Life", slug: "slice-of-life" },
  { title: "Sports", slug: "sports" },
  { title: "Supernatural", slug: "supernatural" },
  { title: "Suspense", slug: "suspense" },
  { title: "Urban Fantasy", slug: "urban-fantasy" },
  { title: "Ecchi", slug: "ecchi" },
  { title: "Erotica", slug: "erotica" },
  { title: "Hentai", slug: "hentai" },
  { title: "Adult Cast", slug: "adult-cast" },
  { title: "Anthropomorphic", slug: "anthropomorphic" },
  { title: "CGDCT", slug: "cgdct" },
  { title: "Childcare", slug: "childcare" },
  { title: "Combat Sports", slug: "combat-sports" },
  { title: "Crossdressing", slug: "crossdressing" },
  { title: "Delinquents", slug: "delinquents" },
  { title: "Detective", slug: "detective" },
  { title: "Educational", slug: "educational" },
  { title: "Gag Humor", slug: "gag-humor" },
  { title: "Gore", slug: "gore" },
  { title: "Harem", slug: "harem" },
  { title: "High Stakes Game", slug: "high-stakes-game" },
  { title: "Historical", slug: "historical" },
  { title: "Idols (Female)", slug: "idols-female" },
  { title: "Idols (Male)", slug: "idols-male" },
  { title: "Isekai", slug: "isekai" },
  { title: "Iyashikei", slug: "iyashikei" },
  { title: "Love Polygon", slug: "love-polygon" },
  { title: "Magical Sex Shift", slug: "magical-sex-shift" },
  { title: "Mahou Shoujo", slug: "mahou-shoujo" },
  { title: "Martial Arts", slug: "martial-arts" },
  { title: "Mecha", slug: "mecha" },
  { title: "Medical", slug: "medical" },
  { title: "Memoir", slug: "memoir" },
  { title: "Military", slug: "military" },
  { title: "Music", slug: "music" },
  { title: "Mythology", slug: "mythology" },
  { title: "Organized Crime", slug: "organized-crime" },
  { title: "Otaku Culture", slug: "otaku-culture" },
  { title: "Parody", slug: "parody" },
  { title: "Performing Arts", slug: "performing-arts" },
  { title: "Pets", slug: "pets" },
  { title: "Psychological", slug: "psychological" },
  { title: "Racing", slug: "racing" },
  { title: "Reincarnation", slug: "reincarnation" },
  { title: "Reverse Harem", slug: "reverse-harem" },
  { title: "Romantic Subtext", slug: "romantic-subtext" },
  { title: "Samurai", slug: "samurai" },
  { title: "School", slug: "school" },
  { title: "Showbiz", slug: "showbiz" },
  { title: "Space", slug: "space" },
  { title: "Strategy Game", slug: "strategy-game" },
  { title: "Super Power", slug: "super-power" },
  { title: "Survival", slug: "survival" },
  { title: "Team Sports", slug: "team-sports" },
  { title: "Time Travel", slug: "time-travel" },
  { title: "Vampire", slug: "vampire" },
  { title: "Video Game", slug: "video-game" },
  { title: "Villainess", slug: "villainess" },
  { title: "Visual Arts", slug: "visual-arts" },
  { title: "Workplace", slug: "workplace" },
  { title: "Josei", slug: "josei" },
  { title: "Kids", slug: "kids" },
  { title: "Seinen", slug: "seinen" },
  { title: "Shoujo", slug: "shoujo" },
  { title: "Shounen", slug: "shounen" },
];

class ManhwaZoneInterceptor extends PaperbackInterceptor {
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

type ManhwaZoneImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ManhwaZoneExtension implements ManhwaZoneImplementation {
  requestManager = new ManhwaZoneInterceptor("main");
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
      {
        id: "genres",
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const items: DiscoverSectionItem[] = GENRES.map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genres: [g.slug] },
        },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as ManhwaZoneMetadata | undefined;
    const page = meta?.page ?? 1;
    const sortBy = section.id === "popular" ? "popularity" : "latest";
    const url = `${BASE_URL}/series?sortBy=${sortBy}&page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const { items: parsed, hasNextPage } = this.parseMangaList($);
    const items: DiscoverSectionItem[] = parsed.map((p) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: p.mangaId,
      imageUrl: p.imageUrl,
      title: p.title,
      metadata: undefined,
    }));

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
    const meta = metadata as ManhwaZoneMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    // Direct URL search (intent handler parity)
    if (titleQuery.startsWith("https://") && titleQuery.includes("manhwazone.com")) {
      const $ = await this.fetchCheerio({ url: titleQuery, method: "GET" });
      const detail = this.parseDetailAsSearch($, titleQuery);
      if (detail) return { items: [detail], metadata: undefined };
      const { items } = this.parseMangaList($);
      return {
        items: items.map((p) => ({
          mangaId: p.mangaId,
          imageUrl: p.imageUrl,
          title: p.title,
          subtitle: undefined,
          metadata: undefined,
        })),
        metadata: undefined,
      };
    }

    const searchMeta = query.metadata as SearchMeta | undefined;

    const params: string[] = [];
    params.push(`page=${page}`);
    if (titleQuery) params.push(`keyword=${encodeURIComponent(titleQuery)}`);
    if (searchMeta?.sortBy) {
      params.push(`sortBy=${encodeURIComponent(searchMeta.sortBy)}`);
    }
    if (searchMeta?.status) {
      params.push(`status=${encodeURIComponent(searchMeta.status)}`);
    }
    const genres = searchMeta?.genres ?? [];
    if (genres.length > 0) {
      params.push(`genres=${encodeURIComponent(genres.join("_"))}`);
    }

    const url = `${BASE_URL}/series?${params.join("&")}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const { items: parsed, hasNextPage } = this.parseMangaList($);
    const results: SearchResultItem[] = parsed.map((p) => ({
      mangaId: p.mangaId,
      imageUrl: p.imageUrl,
      title: p.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private parseMangaList($: CheerioAPI): {
    items: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  } {
    const items: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();

    $("article.group").each((_, element) => {
      const el = $(element);
      const titleAnchor = el.find(".min-w-0 > a.font-semibold").first();
      const title = titleAnchor.text().trim();
      const href = el.find("a").first().attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      const imageUrl = this.imageFromElement(el.find("img").first());
      items.push({ mangaId, imageUrl, title });
    });

    const hasNextPage =
      $("a[rel=next], nav a:contains(›)").length > 0 || items.length >= 24;

    return { items, hasNextPage };
  }

  private parseDetailAsSearch(
    $: CheerioAPI,
    url: string,
  ): SearchResultItem | undefined {
    const title = $("h1.page-title").first().text().trim();
    if (!title) return undefined;
    const imageUrl = this.imageFromElement(
      $("img.aspect-\\[7\\/10\\], figure.relative img").first(),
    );
    return {
      mangaId: this.parsePath(url),
      imageUrl,
      title,
      subtitle: undefined,
      metadata: undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1.page-title").first().text().trim() || this.safeDecode(mangaId);
    const synopsis = $("p.page-subtitle").first().text().trim();
    const thumbnailUrl = this.imageFromElement(
      $("img.aspect-\\[7\\/10\\], figure.relative img").first(),
    );

    const genres = $("a.badge-genre")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const statusText = $(
      "span.badge-sm, span:contains(On Going), span:contains(Completed)",
    )
      .first()
      .text()
      .trim();

    let author: string | undefined;
    const jsonLd = $("script[type=application/ld+json]").first().text();
    if (jsonLd) {
      const m = jsonLd.match(
        /"author":\s*\[\s*\{"@type":"Person","name":"([^"]+)"/,
      );
      if (m && m[1].toLowerCase() !== "unknown") {
        author = m[1];
      }
    }

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
        thumbnailUrl,
        author,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters (Livewire)
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const wireDiv = $(
      "div[wire\\:snapshot][wire\\:id][wire\\:init=bootLoad]",
    ).first();
    const snapshot = wireDiv.attr("wire:snapshot");
    if (!snapshot) return [];

    const csrfToken =
      $("meta[name=csrf-token]").first().attr("content") || "";

    const payload = {
      _token: csrfToken,
      components: [
        {
          snapshot,
          updates: {},
          calls: [
            {
              path: "",
              method: "bootLoad",
              params: [],
            },
          ],
        },
      ],
    };

    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/livewire/update`,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status < 200 || response.status >= 300) return [];

    const chapters: Chapter[] = [];
    try {
      const updateJson = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      ) as {
        components?: { snapshot?: string }[];
      };
      const snapshotStr = updateJson.components?.[0]?.snapshot;
      if (!snapshotStr) return [];

      const snapshotJson = JSON.parse(snapshotStr) as {
        data?: { chapters?: unknown };
      };
      const chaptersRaw = snapshotJson.data?.chapters;
      // chapters is shaped as [ [ [chapterObj, meta?], ... ], meta? ]
      if (!Array.isArray(chaptersRaw)) return [];
      const actualChapters = chaptersRaw[0];
      if (!Array.isArray(actualChapters)) return [];

      const seen = new Set<string>();
      for (let i = 0; i < actualChapters.length; i++) {
        const tuple = actualChapters[i];
        const chapterObj = Array.isArray(tuple) ? tuple[0] : tuple;
        if (!chapterObj || typeof chapterObj !== "object") continue;
        const c = chapterObj as {
          name?: string;
          published?: string;
          web_url?: string;
        };
        const webUrl = c.web_url;
        if (!webUrl) continue;
        const chapterId = this.parsePath(webUrl);
        if (!chapterId || seen.has(chapterId)) continue;
        seen.add(chapterId);

        const name = c.name || "Chapter";
        chapters.push({
          chapterId,
          sourceManga,
          title: name,
          volume: 0,
          chapNum: this.parseChapterNumber(name),
          publishDate: this.parseDate(c.published),
          langCode: "🇬🇧",
        });
      }
    } catch {
      return [];
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];

    // Primary: __RS_CONF__ signed image config
    let confScript = "";
    $("script").each((_, el) => {
      if (confScript) return;
      const text = $(el).text();
      if (text.includes("__RS_CONF__")) {
        confScript = text;
      }
    });

    if (confScript) {
      const m = confScript.match(/__RS_CONF__\s*=\s*(\{[\s\S]*?\})\s*;/);
      if (m) {
        try {
          const conf = JSON.parse(m[1]) as {
            p?: string;
            expire?: string;
            signature?: string;
            tt?: number;
          };
          if (
            conf.p &&
            conf.expire &&
            conf.signature &&
            typeof conf.tt === "number" &&
            conf.tt > 0
          ) {
            for (let i = 1; i <= conf.tt; i++) {
              const pageStr = i.toString().padStart(3, "0");
              pages.push(
                `https://img.mangalaxy.net/_img/${conf.p}/${pageStr}.webp?e=${conf.expire}&s=${conf.signature}`,
              );
            }
          }
        } catch {
          // fall through to fallback
        }
      }
    }

    // Fallback: lazy-image data-src
    if (pages.length === 0) {
      $("img.lazy-image[data-src]").each((_, el) => {
        const src = $(el).attr("data-src") || "";
        if (src) pages.push(this.absoluteUrl(src));
      });
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
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseDate(dateStr?: string): Date {
    if (!dateStr) return new Date(0);
    // upstream format: "yyyy-MM-dd HH:mm:ss"
    const normalized = dateStr.trim().replace(" ", "T");
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;
    const d2 = new Date(dateStr);
    return isNaN(d2.getTime()) ? new Date(0) : d2;
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

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (
      s.includes("on going") ||
      s.includes("ongoing") ||
      s.includes("currently publishing")
    )
      return "Ongoing";
    if (s.includes("completed") || s.includes("finished")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("discontinued") || s.includes("cancelled"))
      return "Cancelled";
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

export const ManhwaZone = new ManhwaZoneExtension();
