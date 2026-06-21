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
import { TempleScanSearchForm, TempleScanSearchMeta } from "./forms";

const BASE_URL = "https://templetoons.com";
const PAGE_SIZE = 20;

interface TempleScanMetadata {
  page?: number;
}

interface BrowseSeries {
  series_slug: string;
  title: string;
  alternative_names?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  update_chapter?: string | null;
  created_at?: string | null;
  total_views?: number;
}

interface SeriesDetails {
  series_slug: string;
  title: string;
  thumbnail?: string | null;
  author?: string | null;
  studio?: string | null;
  release_year?: string | null;
  alternative_names?: string | null;
  adult?: boolean;
  badge?: string | null;
  status?: string | null;
}

interface ChapterDto {
  chapter_name: string;
  chapter_title?: string | null;
  chapter_slug: string;
  price: number;
  created_at?: string | null;
}

interface SeasonDto {
  Chapter: ChapterDto[];
}

interface ChapterListDto {
  Season: SeasonDto[];
}

class TempleScanInterceptor extends PaperbackInterceptor {
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

type TempleScanImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class TempleScanExtension implements TempleScanImplementation {
  requestManager = new TempleScanInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private seriesCache: BrowseSeries[] | undefined;

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
      | { searchMeta?: TempleScanSearchMeta }
      | undefined;
    return new TempleScanSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as TempleScanMetadata | undefined;
    const page = meta?.page ?? 1;

    const order = section.id === "latest" ? "updated" : "views";
    const { series, hasNextPage } = await this.queryDirectory(
      "",
      undefined,
      order,
      page,
    );

    const items: DiscoverSectionItem[] = series.map((s) => ({
      type:
        section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem",
      mangaId: this.parsePath(`/comic/${s.series_slug}`),
      imageUrl: this.absoluteUrl(s.thumbnail ?? ""),
      title: s.title,
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
    const meta = metadata as TempleScanMetadata | undefined;
    const page = meta?.page ?? 1;

    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: TempleScanSearchMeta } | undefined
    )?.searchMeta;

    const status = searchMeta?.status?.[0];
    const order = searchMeta?.order?.[0];

    const { series, hasNextPage } = await this.queryDirectory(
      titleQuery,
      status,
      order,
      page,
    );

    const results: SearchResultItem[] = series.map((s) => ({
      mangaId: this.parsePath(`/comic/${s.series_slug}`),
      imageUrl: this.absoluteUrl(s.thumbnail ?? ""),
      title: s.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async queryDirectory(
    query: string,
    status: string | undefined,
    order: string | undefined,
    page: number,
  ): Promise<{ series: BrowseSeries[]; hasNextPage: boolean }> {
    if (page === 1 || !this.seriesCache) {
      await this.loadDirectory();
    }
    const all = this.seriesCache ?? [];

    const q = query.toLowerCase();
    let filtered = all.filter((series) => {
      const queryFilter =
        q.length === 0 ||
        series.title.toLowerCase().includes(q) ||
        (series.alternative_names ?? "").toLowerCase().includes(q);
      const statusFilter = !status || series.status === status;
      return queryFilter && statusFilter;
    });

    if (order === "updated") {
      filtered = filtered
        .slice()
        .sort(
          (a, b) =>
            this.parseTime(b.update_chapter) - this.parseTime(a.update_chapter),
        );
    } else if (order === "created") {
      filtered = filtered
        .slice()
        .sort(
          (a, b) => this.parseTime(b.created_at) - this.parseTime(a.created_at),
        );
    } else if (order === "views") {
      filtered = filtered
        .slice()
        .sort((a, b) => (b.total_views ?? 0) - (a.total_views ?? 0));
    }

    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(page * PAGE_SIZE, filtered.length);
    return {
      series: filtered.slice(start, end),
      hasNextPage: page * PAGE_SIZE < filtered.length,
    };
  }

  private async loadDirectory(): Promise<void> {
    const html = await this.fetchString({
      url: `${BASE_URL}/comics`,
      method: "GET",
    });
    const unescaped = this.unescape(html);
    const json = this.extractJson(unescaped, '"allComics":', "[");
    this.seriesCache = json ? (JSON.parse(json) as BrowseSeries[]) : [];
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const html = await this.fetchString({ url, method: "GET" });
    const unescaped = this.unescape(html);
    const json = this.extractJson(unescaped, '"info":', "{");
    const details: SeriesDetails = json
      ? (JSON.parse(json) as SeriesDetails)
      : { series_slug: "", title: this.safeDecode(mangaId) };

    const synopsisParts: string[] = [];
    if (details.alternative_names && details.alternative_names.trim()) {
      synopsisParts.push(`Alternative Name: ${details.alternative_names}`);
    }

    const tags: string[] = [];
    if (details.badge) tags.push(details.badge);
    if (details.release_year) tags.push(details.release_year);
    if (details.adult) tags.push("Adult");

    const tagGroups: TagSection[] = [];
    if (tags.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: tags.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: details.title,
        secondaryTitles: details.alternative_names
          ? [details.alternative_names]
          : [],
        thumbnailUrl: this.absoluteUrl(details.thumbnail ?? ""),
        author: details.author ?? undefined,
        artist: details.studio ?? undefined,
        synopsis: synopsisParts.join("\n\n"),
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(details.status ?? ""),
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
    const html = await this.fetchString({ url, method: "GET" });
    const unescaped = this.unescape(html);
    const json = this.extractJson(unescaped, '"info":', "{");
    if (!json) return [];

    const list = JSON.parse(json) as ChapterListDto;
    const mangaSlug = this.safeDecode(sourceManga.mangaId)
      .replace(/\/+$/, "")
      .split("/")
      .pop();

    const chapters: Chapter[] = [];
    for (const season of list.Season ?? []) {
      for (const chapter of season.Chapter ?? []) {
        if (chapter.price !== 0) continue;
        const name =
          chapter.chapter_name +
          (chapter.chapter_title && chapter.chapter_title.trim()
            ? `: ${chapter.chapter_title}`
            : "");
        chapters.push({
          chapterId: this.parsePath(
            `/comic/${mangaSlug}/${chapter.chapter_slug}`,
          ),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: this.parseChapterNumber(chapter.chapter_name),
          publishDate: this.parseDate(chapter.created_at),
          langCode: "🇬🇧",
        });
      }
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const html = await this.fetchString({ url, method: "GET" });
    const unescaped = this.unescape(html);
    const json = this.extractJson(unescaped, '"images":', "[");
    const images = json ? (JSON.parse(json) as string[]) : [];

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: images.map((img) => this.absoluteUrl(img)),
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private unescape(text: string): string {
    return text.replace(/\\(.)/g, "$1");
  }

  // Find marker, then extract the balanced JSON structure (object/array)
  // starting at the next openChar, respecting quoted strings.
  private extractJson(
    text: string,
    marker: string,
    openChar: "{" | "[",
  ): string | undefined {
    const markerIdx = text.indexOf(marker);
    if (markerIdx < 0) return undefined;
    const start = text.indexOf(openChar, markerIdx + marker.length);
    if (start < 0) return undefined;
    const closeChar = openChar === "{" ? "}" : "]";

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }
    return undefined;
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
    let cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
    if (!cleaned.startsWith("/")) cleaned = `/${cleaned}`;
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

  private parseStatus(status: string): string {
    switch (status) {
      case "Ongoing":
        return "Ongoing";
      case "Hiatus":
        return "Hiatus";
      case "Completed":
        return "Completed";
      case "Canceled":
      case "Dropped":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseTime(date: string | null | undefined): number {
    if (!date) return 0;
    const t = new Date(date).getTime();
    return isNaN(t) ? 0 : t;
  }

  private parseDate(date: string | null | undefined): Date {
    if (!date) return new Date(0);
    const d = new Date(date);
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

  async fetchString(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
  }
}

export const TempleScan = new TempleScanExtension();
