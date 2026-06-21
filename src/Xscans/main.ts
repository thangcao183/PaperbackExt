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

const BASE_URL = "https://xscans.site";
const PAGE_LIMIT = 24;

interface XscansMetadata {
  page?: number;
}

interface ChapterEntry {
  number: number;
  title?: string;
  publishDate?: string;
  isLocked?: boolean;
}

interface MangaEntry {
  slug?: string;
  title?: string;
  coverImage?: string;
  description?: string;
  authors?: string[];
  artists?: string[];
  status?: string;
  genres?: string[];
  demographics?: string[];
  chapters?: ChapterEntry[];
}

class XscansInterceptor extends PaperbackInterceptor {
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

type XscansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class XscansExtension implements XscansImplementation {
  requestManager = new XscansInterceptor("main");
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
        id: "newest",
        title: "Newest",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "updated",
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
          metadata: { genre: g },
        },
        name: g,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as XscansMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort =
      section.id === "popular"
        ? "popular"
        : section.id === "updated"
          ? "updated"
          : "newest";

    const url = `${BASE_URL}/api/manga?limit=${PAGE_LIMIT}&sort=${sort}&page=${page}`;
    const { mangas, hasNextPage } = await this.fetchMangaList(url);

    const items: DiscoverSectionItem[] = mangas.map((m) => ({
      type: "simpleCarouselItem",
      mangaId: this.toSafeId(m.slug ?? ""),
      imageUrl: this.absoluteUrl(m.coverImage ?? ""),
      title: m.title ?? this.safeDecode(m.slug ?? ""),
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
    const meta = metadata as XscansMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const filterMeta = query.metadata as
      | { genre?: string; sort?: string; demographic?: string }
      | undefined;

    const params: string[] = [];
    params.push(`limit=${PAGE_LIMIT}`);
    params.push(`page=${page}`);
    if (titleQuery) params.push(`q=${encodeURIComponent(titleQuery)}`);
    if (filterMeta?.sort) params.push(`sort=${encodeURIComponent(filterMeta.sort)}`);
    if (filterMeta?.genre) params.push(`genres=${encodeURIComponent(filterMeta.genre)}`);
    if (filterMeta?.demographic)
      params.push(`demographic=${encodeURIComponent(filterMeta.demographic)}`);

    const url = `${BASE_URL}/api/manga?${params.join("&")}`;
    const { mangas, hasNextPage } = await this.fetchMangaList(url);

    const results: SearchResultItem[] = mangas.map((m) => ({
      mangaId: this.toSafeId(m.slug ?? ""),
      imageUrl: this.absoluteUrl(m.coverImage ?? ""),
      title: m.title ?? this.safeDecode(m.slug ?? ""),
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const manga = await this.fetchMangaEntry(mangaId);

    const genres = (manga.genres ?? []).filter((g) => g.length > 0);
    const demographics = (manga.demographics ?? []).filter((g) => g.length > 0);

    const tagGroups: TagSection[] = [];
    const tags = [...genres, ...demographics].map((g) => ({
      id: g.toLowerCase().replace(/\s+/g, "-"),
      title: g,
    }));
    if (tags.length > 0) {
      tagGroups.push({ id: "genres", title: "Genres", tags });
    }

    const author = (manga.authors ?? []).join(", ");
    const artist = (manga.artists ?? []).join(", ");

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.title ?? this.safeDecode(mangaId),
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(manga.coverImage ?? ""),
        author: author || undefined,
        artist: artist || undefined,
        synopsis: manga.description ?? "",
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(manga.status),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const manga = await this.fetchMangaEntry(sourceManga.mangaId);
    const slug = this.safeDecode(sourceManga.mangaId);

    const chapterDtos = (manga.chapters ?? []).slice();
    chapterDtos.sort((a, b) => b.number - a.number);

    const chapters: Chapter[] = [];
    for (const c of chapterDtos) {
      const num = typeof c.number === "number" ? c.number : 0;
      const numStr = this.formatNumber(num);
      const baseName =
        c.title && c.title.trim().length > 0
          ? c.title.trim()
          : `Chapter ${numStr}`;
      const name = c.isLocked ? `🔒 ${baseName}` : baseName;

      const chapterId = this.toSafeId(
        `/api/manga/${slug}/chapters?number=${numStr}`,
      );

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: num,
        publishDate: this.parseDate(c.publishDate),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.absoluteUrl(this.safeDecode(chapter.chapterId));
    const json = await this.fetchJson(url);

    const pages: string[] = [];
    if (json && typeof json === "object") {
      const images = (json as { images?: unknown }).images;
      if (Array.isArray(images)) {
        for (const img of images) {
          if (typeof img === "string" && img.length > 0) {
            pages.push(this.absoluteUrl(img));
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
  // Data fetching
  // ----------------------------------------------------------------

  private async fetchMangaList(
    url: string,
  ): Promise<{ mangas: MangaEntry[]; hasNextPage: boolean }> {
    const json = await this.fetchJson(url);
    const mangas: MangaEntry[] = [];
    let hasNextPage = false;

    if (json && typeof json === "object") {
      const obj = json as {
        manga?: unknown;
        pagination?: { hasMore?: unknown };
      };
      if (Array.isArray(obj.manga)) {
        for (const item of obj.manga) {
          if (item && typeof item === "object") {
            mangas.push(item as MangaEntry);
          }
        }
      }
      hasNextPage = obj.pagination?.hasMore === true;
    }

    return { mangas, hasNextPage };
  }

  private async fetchMangaEntry(mangaId: string): Promise<MangaEntry> {
    const slug = this.safeDecode(mangaId);

    // Preferred: dedicated per-slug API endpoint.
    try {
      const json = await this.fetchJson(`${BASE_URL}/api/manga/${slug}`);
      const entry = this.extractMangaEntry(json);
      if (entry) return entry;
    } catch {
      // fall through to the Next.js page extraction below
    }

    // Fallback: scrape the embedded Next.js data from the manga page.
    const html = await this.fetchText(`${BASE_URL}/manga/${slug}`);
    const entry = this.extractInitialManga(html);
    if (entry) return entry;

    return { slug };
  }

  private extractMangaEntry(json: unknown): MangaEntry | undefined {
    if (!json || typeof json !== "object") return undefined;
    const obj = json as Record<string, unknown>;
    if (typeof obj.slug === "string" || typeof obj.title === "string") {
      return obj as MangaEntry;
    }
    // Some APIs wrap the payload, e.g. { manga: {...} } or { data: {...} }.
    for (const key of ["manga", "data", "initialManga"]) {
      const nested = obj[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const n = nested as Record<string, unknown>;
        if (typeof n.slug === "string" || typeof n.title === "string") {
          return n as MangaEntry;
        }
      }
    }
    return undefined;
  }

  private extractInitialManga(html: string): MangaEntry | undefined {
    // The Next.js manga page embeds the manga object keyed by "initialManga".
    const marker = '"initialManga":';
    const idx = html.indexOf(marker);
    if (idx < 0) return undefined;

    const start = html.indexOf("{", idx + marker.length);
    if (start < 0) return undefined;

    const objStr = this.matchBalanced(html, start);
    if (!objStr) return undefined;

    try {
      const parsed = JSON.parse(objStr);
      if (parsed && typeof parsed === "object") {
        return parsed as MangaEntry;
      }
    } catch {
      // Embedded JSON may be escaped (RSC flight payload). Try unescaping.
      try {
        const unescaped = objStr
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
          .replace(/\\n/g, "");
        const parsed = JSON.parse(unescaped);
        if (parsed && typeof parsed === "object") {
          return parsed as MangaEntry;
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  // Extract a balanced { ... } block starting at index `start`.
  private matchBalanced(text: string, start: number): string | undefined {
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
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    return undefined;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str);
  }

  private async fetchText(url: string): Promise<string> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { rsc: "1" },
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
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
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private formatNumber(n: number): string {
    return n.toString();
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    if (Number.isNaN(t)) return new Date(0);
    return new Date(t);
  }

  private parseStatus(status?: string): string {
    switch ((status || "").toLowerCase()) {
      case "ongoing":
        return "Ongoing";
      case "completed":
        return "Completed";
      case "hiatus":
        return "Hiatus";
      case "cancelled":
      case "dropped":
        return "Cancelled";
      default:
        return "Unknown";
    }
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
}

const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Crime",
  "Drama",
  "Fantasy",
  "Historical",
  "Horror",
  "Isekai",
  "Mystery",
  "Psychological",
  "Romance",
  "Slice of Life",
  "Sports",
  "Tragedy",
];

export const Xscans = new XscansExtension();
