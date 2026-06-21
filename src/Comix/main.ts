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
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://comix.to";

interface ComixMetadata {
  page?: number;
}

// ----------------------------------------------------------------
// Upstream JSON shapes (subset of the comix.to API embedded in the
// server-rendered `<script id="initial-data">` blob).
// ----------------------------------------------------------------

interface Term {
  title?: string;
}

interface Poster {
  small?: string;
  medium?: string;
  large?: string;
}

interface MangaDto {
  hid?: string;
  title?: string;
  altTitles?: string[];
  alt_titles?: string[];
  synopsis?: string | null;
  type?: string;
  poster?: Poster | null;
  status?: string;
  contentRating?: string;
  authors?: Term[] | null;
  author?: Term[] | null;
  artists?: Term[] | null;
  artist?: Term[] | null;
  genres?: Term[] | null;
  genre?: Term[] | null;
  tags?: Term[] | null;
  demographics?: Term[] | null;
  demographic?: Term[] | null;
  year?: number | null;
  url?: string | null;
}

interface ChapterDto {
  id?: number;
  url?: string;
  number?: number;
  name?: string;
  createdAtFormatted?: string;
  group?: { id?: number; name?: string } | null;
  isOfficial?: boolean;
}

interface PageDto {
  url?: string;
  s?: number;
}

class ComixInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "*/*",
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

type ComixImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ComixExtension implements ComixImplementation {
  requestManager = new ComixInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
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
    const meta = metadata as ComixMetadata | undefined;
    const page = meta?.page ?? 1;

    const url =
      section.id === "popular"
        ? `${BASE_URL}/browse?order%5Bscore%5D=desc&content_rating=safe,suggestive,erotica,pornographic&page=${page}`
        : `${BASE_URL}/browse?order%5Bchapter_updated_at%5D=desc&content_rating=safe,suggestive,erotica,pornographic&page=${page}`;

    const { mangas, hasNextPage } = await this.fetchBrowse(url);

    const items: DiscoverSectionItem[] = mangas.map((m) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
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
    const meta = metadata as ComixMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    // Pasting a comix.to title URL jumps straight to that series.
    const titlePath = this.titlePathFromQuery(titleQuery);
    if (titlePath) {
      const sourceManga = await this.getMangaDetails(titlePath);
      return {
        items: [
          {
            mangaId: sourceManga.mangaId,
            imageUrl: sourceManga.mangaInfo.thumbnailUrl,
            title: sourceManga.mangaInfo.primaryTitle,
            subtitle: undefined,
            metadata: undefined,
          },
        ],
        metadata: undefined,
      };
    }

    const params: string[] = [];
    params.push("content_rating=safe,suggestive,erotica,pornographic");
    if (titleQuery) {
      params.push(`q=${encodeURIComponent(titleQuery)}`);
      params.push("sort=relevance:desc");
    } else {
      params.push("order%5Bscore%5D=desc");
    }
    params.push(`page=${page}`);

    const url = `${BASE_URL}/browse?${params.join("&")}`;
    const { mangas, hasNextPage } = await this.fetchBrowse(url);

    const items: SearchResultItem[] = mangas.map((m) => ({
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const root = this.extractInitialData($);
    const detail = root ? this.findDetailManga(root) : undefined;

    if (!detail) {
      return {
        mangaId,
        mangaInfo: {
          primaryTitle: this.safeDecode(mangaId),
          secondaryTitles: [],
          thumbnailUrl: "",
          synopsis: "",
          contentRating: ContentRating.MATURE,
          status: "Unknown",
          tagGroups: [],
          shareUrl: url,
        },
      };
    }

    const authors = (detail.authors ?? detail.author ?? [])
      .map((t) => (t.title ?? "").trim())
      .filter((t) => t.length > 0)
      .join(", ");
    const artists = (detail.artists ?? detail.artist ?? [])
      .map((t) => (t.title ?? "").trim())
      .filter((t) => t.length > 0)
      .join(", ");

    const genreNames: string[] = [];
    switch (detail.type) {
      case "manhwa":
        genreNames.push("Manhwa");
        break;
      case "manhua":
        genreNames.push("Manhua");
        break;
      case "manga":
        genreNames.push("Manga");
        break;
      default:
        genreNames.push("Other");
        break;
    }
    for (const t of detail.genres ?? detail.genre ?? []) {
      const n = (t.title ?? "").trim();
      if (n) genreNames.push(n);
    }
    for (const t of detail.demographics ?? detail.demographic ?? []) {
      const n = (t.title ?? "").trim();
      if (n) genreNames.push(n);
    }
    const cr = detail.contentRating ?? "safe";
    if (cr === "erotica" || cr === "pornographic") genreNames.push("NSFW");

    const tagGroups: TagSection[] = [];
    const uniqueGenres = [...new Set(genreNames)];
    if (uniqueGenres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: uniqueGenres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    const altTitles = (detail.altTitles ?? detail.alt_titles ?? []).filter(
      (s) => !!s && s.length > 0,
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: detail.title ?? this.safeDecode(mangaId),
        secondaryTitles: altTitles,
        thumbnailUrl: this.posterUrl(detail.poster),
        author: authors || undefined,
        artist: artists || undefined,
        synopsis: detail.synopsis ?? "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(detail.status ?? ""),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaSlug = this.safeDecode(sourceManga.mangaId).replace(/^\/+/, "");
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const root = this.extractInitialData($);
    const rawChapters = root ? this.findChapterItems(root) : [];

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const ch of rawChapters) {
      if (ch.id === undefined || ch.number === undefined) continue;
      const numStr = ch.number.toString();
      const chapterUrlPath =
        ch.url && ch.url.indexOf("/title/") !== -1
          ? ch.url.substring(ch.url.indexOf("/title/"))
          : `/title/${mangaSlug}/${ch.id}-chapter-${numStr}`;
      const chapterId = this.parsePath(chapterUrlPath);
      if (!chapterId || seen.has(chapterId)) continue;
      seen.add(chapterId);

      const namePart =
        ch.name && ch.name.trim().length > 0 ? `: ${ch.name.trim()}` : "";
      chapters.push({
        chapterId,
        sourceManga,
        title: `Chapter ${numStr}${namePart}`,
        volume: 0,
        chapNum: ch.number,
        publishDate: this.parseRelativeDate(ch.createdAtFormatted ?? ""),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const root = this.extractInitialData($);
    const result = root ? this.findPages(root) : undefined;

    const pages: string[] = [];
    if (result) {
      const base = (result.baseUrl ?? "").replace(/\/+$/, "");
      for (const img of result.items) {
        const raw = (img.url ?? "").trim();
        if (!raw) continue;
        const full = raw.startsWith("http")
          ? raw
          : `${base}/${raw.replace(/^\/+/, "")}`;
        pages.push(full);
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
  // Browse helper (parses the embedded initial-data JSON)
  // ----------------------------------------------------------------

  private async fetchBrowse(url: string): Promise<{
    mangas: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  }> {
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const root = this.extractInitialData($);
    const items = root ? this.findBrowseItems(root) : undefined;

    if (!items) return { mangas: [], hasNextPage: false };

    const mangas: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const m of items.items) {
      const slug = m.url
        ? m.url.substring(m.url.indexOf("/title") + "/title".length)
        : m.hid
          ? `/${m.hid}`
          : "";
      const mangaId = this.parsePath(slug);
      if (!mangaId || seen.has(mangaId)) continue;
      seen.add(mangaId);
      mangas.push({
        mangaId,
        imageUrl: this.posterUrl(m.poster),
        title: m.title ?? this.safeDecode(mangaId),
      });
    }

    return { mangas, hasNextPage: items.hasNextPage };
  }

  // ----------------------------------------------------------------
  // initial-data parsing
  // ----------------------------------------------------------------

  private extractInitialData($: CheerioAPI): Record<string, unknown> | undefined {
    const raw = $("script#initial-data").first().text();
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      const queries = (parsed as { queries?: unknown })?.queries;
      if (queries && typeof queries === "object") {
        return queries as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private findBrowseItems(
    queries: Record<string, unknown>,
  ): { items: MangaDto[]; hasNextPage: boolean } | undefined {
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (result && Array.isArray((result as { items?: unknown }).items)) {
        const itemsRaw = (result as { items: unknown[] }).items;
        if (itemsRaw.length === 0) continue;
        // Differentiate manga lists from chapter lists by sampling the first item.
        const first = itemsRaw[0] as Record<string, unknown>;
        if (first && (first.title !== undefined || first.hid !== undefined)) {
          return {
            items: itemsRaw as MangaDto[],
            hasNextPage: this.computeHasNextPage(result),
          };
        }
      }
    }
    return undefined;
  }

  private findChapterItems(queries: Record<string, unknown>): ChapterDto[] {
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (result && Array.isArray((result as { items?: unknown }).items)) {
        const itemsRaw = (result as { items: unknown[] }).items;
        if (itemsRaw.length === 0) continue;
        const first = itemsRaw[0] as Record<string, unknown>;
        if (first && first.id !== undefined && first.number !== undefined) {
          return itemsRaw as ChapterDto[];
        }
      }
    }
    return [];
  }

  private findDetailManga(
    queries: Record<string, unknown>,
  ): MangaDto | undefined {
    // The detail query key contains the literal string "detail".
    for (const [key, value] of Object.entries(queries)) {
      if (!key.includes("detail")) continue;
      const result = this.getResult(value);
      if (result && typeof result === "object") {
        const candidate = result as MangaDto;
        if (candidate.title !== undefined || candidate.hid !== undefined) {
          return candidate;
        }
      }
    }
    // Fallback: any query whose result looks like a single manga.
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (result && typeof result === "object") {
        const candidate = result as MangaDto;
        if (
          (candidate.title !== undefined || candidate.hid !== undefined) &&
          (candidate as { items?: unknown }).items === undefined
        ) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private findPages(
    queries: Record<string, unknown>,
  ): { baseUrl: string; items: PageDto[] } | undefined {
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (!result || typeof result !== "object") continue;
      const pages = (result as { pages?: unknown }).pages;
      if (pages && typeof pages === "object") {
        const p = pages as { baseUrl?: string; items?: unknown };
        if (Array.isArray(p.items)) {
          return {
            baseUrl: p.baseUrl ?? "",
            items: p.items as PageDto[],
          };
        }
      }
    }
    return undefined;
  }

  // Each React-Query entry may be the result object directly, or wrapped in
  // `{ result: ... }`, or in a React-Query `{ state: { data: ... } }` shape.
  private getResult(value: unknown): unknown {
    if (!value || typeof value !== "object") return undefined;
    const obj = value as Record<string, unknown>;
    if (obj.result !== undefined) {
      const r = obj.result as Record<string, unknown>;
      if (r && typeof r === "object" && r.result !== undefined) {
        return r.result;
      }
      return obj.result;
    }
    if (obj.state && typeof obj.state === "object") {
      const data = (obj.state as Record<string, unknown>).data;
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        return d.result !== undefined ? d.result : d;
      }
    }
    return obj;
  }

  private computeHasNextPage(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const obj = result as Record<string, unknown>;
    const metaLike = (obj.meta ?? obj.pagination) as
      | Record<string, unknown>
      | undefined;
    if (!metaLike) return false;
    if (typeof metaLike.hasNext === "boolean") return metaLike.hasNext;
    const page = this.asNumber(metaLike.page) ?? 1;
    const lastPage =
      this.asNumber(metaLike.lastPage) ??
      this.asNumber(metaLike.last_page) ??
      1;
    return page < lastPage;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private titlePathFromQuery(query: string): string | undefined {
    const trimmed = query.trim();
    if (!trimmed) return undefined;
    let parsedHost = "";
    let pathSegments: string[] = [];
    try {
      const u = new URL(trimmed);
      parsedHost = u.host.replace(/^www\./, "");
      pathSegments = u.pathname.split("/").filter((s) => s.length > 0);
    } catch {
      return undefined;
    }
    if (parsedHost !== "comix.to") return undefined;
    if (pathSegments.length < 2 || pathSegments[0] !== "title") return undefined;
    const mangaId = pathSegments[1].split("-")[0];
    if (!mangaId) return undefined;
    return this.parsePath(`/${mangaId}`);
  }

  private posterUrl(poster: Poster | null | undefined): string {
    if (!poster) return "";
    return poster.large || poster.medium || poster.small || "";
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/title/${slug.replace(/^\/+/, "")}`;
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

  private parseStatus(status: string): string {
    switch (status) {
      case "releasing":
        return "Ongoing";
      case "on_hiatus":
        return "Hiatus";
      case "finished":
        return "Completed";
      case "discontinued":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseRelativeDate(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    const trimmed = dateStr.trim().toLowerCase().replace(/ ago$/, "");
    const match = trimmed.match(
      /^(\d+)\s*(s|m|h|d|w|mo|mos|y|yr|yrs|min|mins|sec|secs|hr|hrs|day|days|week|weeks|month|months|year|years)$/,
    );
    if (!match) return new Date(0);
    const amount = parseInt(match[1], 10);
    if (Number.isNaN(amount)) return new Date(0);
    const unit = match[2];
    const now = Date.now();
    const sec = 1000;
    const min = 60 * sec;
    const hour = 60 * min;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;
    let offset = 0;
    switch (unit) {
      case "s":
      case "sec":
      case "secs":
        offset = amount * sec;
        break;
      case "m":
      case "min":
      case "mins":
        offset = amount * min;
        break;
      case "h":
      case "hr":
      case "hrs":
        offset = amount * hour;
        break;
      case "d":
      case "day":
      case "days":
        offset = amount * day;
        break;
      case "w":
      case "week":
      case "weeks":
        offset = amount * week;
        break;
      case "mo":
      case "mos":
      case "month":
      case "months":
        offset = amount * month;
        break;
      case "y":
      case "yr":
      case "yrs":
      case "year":
      case "years":
        offset = amount * year;
        break;
      default:
        return new Date(0);
    }
    return new Date(now - offset);
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

export const Comix = new ComixExtension();
