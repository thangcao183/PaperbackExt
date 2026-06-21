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

const BASE_URL = "https://www.revivalscans.com";

// Revival Scans is a Next.js (App Router) site. All data is served as React
// Server Component flight payloads, requested with the `RSC: 1` header which
// returns a raw `text/x-component` body rather than HTML. We port the upstream
// keiyoushi `extractNextJsRsc` logic to parse those flight chunks as JSON.
const RSC_HEADERS: Record<string, string> = { RSC: "1" };

interface SeriesEntry {
  id: string;
  title: string;
  coverImage?: string;
  status?: string;
  description?: string;
  author?: string;
  artist?: string;
  genres?: string[];
  chapters?: ChapterEntry[];
}

interface ChapterEntry {
  id: string;
  number: number;
  title?: string;
  releaseDate?: string;
  accessRoles?: string[];
}

class RevivalScansInterceptor extends PaperbackInterceptor {
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

type RevivalScansImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class RevivalScansExtension implements RevivalScansImplementation {
  requestManager = new RevivalScansInterceptor("main");
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
        id: "series",
        title: "All Series",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const series = await this.fetchSeriesList();
    const items: DiscoverSectionItem[] = series.map((s) => ({
      type: "simpleCarouselItem",
      mangaId: this.toSafeId(s.id),
      imageUrl: this.coverUrl(s.coverImage),
      title: s.title,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  // Upstream has no real search endpoint: it fetches the full series list and
  // filters by title client-side.
  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const series = await this.fetchSeriesList();

    const items: SearchResultItem[] = series
      .filter(
        (s) => titleQuery === "" || s.title.toLowerCase().includes(titleQuery),
      )
      .map((s) => ({
        mangaId: this.toSafeId(s.id),
        imageUrl: this.coverUrl(s.coverImage),
        title: s.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items, metadata: undefined };
  }

  private async fetchSeriesList(): Promise<SeriesEntry[]> {
    const body = await this.fetchString({
      url: `${BASE_URL}/series`,
      method: "GET",
      headers: RSC_HEADERS,
    });

    const container = this.findRscObject(
      body,
      (obj) => Array.isArray(obj.series),
    );
    if (!container) {
      throw new Error("Failed to extract popular manga");
    }

    const out: SeriesEntry[] = [];
    const seen = new Set<string>();
    for (const raw of container.series as unknown[]) {
      const entry = this.toSeriesEntry(raw);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const manhwa = await this.fetchManhwa(mangaId);

    const genres = (manhwa.genres ?? []).filter((g) => g.length > 0);
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
        primaryTitle: manhwa.title || this.safeDecode(mangaId),
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(manhwa.coverImage),
        author: manhwa.author,
        artist: manhwa.artist,
        synopsis: manhwa.description ?? "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(manhwa.status),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const manhwa = await this.fetchManhwa(sourceManga.mangaId);
    const seriesId = manhwa.id;

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const raw of manhwa.chapters ?? []) {
      const id = raw.id;
      if (typeof id !== "string" || id.length === 0) continue;

      const isPremium =
        Array.isArray(raw.accessRoles) && !raw.accessRoles.includes("reader");

      const chapterId = this.parsePath(`/read/${seriesId}/${id}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const numStr = Number.isFinite(raw.number)
        ? String(raw.number).replace(/\.0$/, "")
        : "";
      const baseName =
        raw.title && raw.title.length > 0
          ? raw.title
          : `Chapter ${numStr}`;
      const name = isPremium ? `🔒 ${baseName}` : baseName;

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: Number.isFinite(raw.number) ? raw.number : 0,
        publishDate: this.parseDate(raw.releaseDate),
        langCode: "🇬🇧",
      });
    }

    // Sort by chapter number descending, mirroring upstream.
    chapters.sort((a, b) => b.chapNum - a.chapNum);
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const body = await this.fetchString({
      url: this.chapterUrl(chapter.chapterId),
      method: "GET",
      headers: RSC_HEADERS,
    });

    const container = this.findRscObject(
      body,
      (obj) => Array.isArray(obj.pages),
    );

    const pages: string[] = [];
    if (container) {
      for (const raw of container.pages as unknown[]) {
        if (typeof raw !== "object" || raw === null) continue;
        const url = (raw as { url?: unknown }).url;
        if (typeof url === "string" && url.length > 0) {
          pages.push(this.absoluteUrl(url));
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

  private async fetchManhwa(mangaId: string): Promise<SeriesEntry> {
    const body = await this.fetchString({
      url: this.mangaUrl(mangaId),
      method: "GET",
      headers: RSC_HEADERS,
    });

    const container = this.findRscObject(
      body,
      (obj) =>
        typeof obj.manhwa === "object" &&
        obj.manhwa !== null &&
        typeof (obj.manhwa as Record<string, unknown>).id === "string" &&
        typeof (obj.manhwa as Record<string, unknown>).title === "string",
    );

    const manhwaRaw = container
      ? (container.manhwa as unknown)
      : // Fallback: match the manhwa object directly if it is not wrapped.
        this.findRscObject(
          body,
          (obj) =>
            typeof obj.id === "string" &&
            typeof obj.title === "string" &&
            (Array.isArray(obj.chapters) || Array.isArray(obj.genres)),
        );

    const entry = this.toSeriesEntry(manhwaRaw);
    if (!entry) {
      throw new Error("Failed to extract manga details");
    }
    return entry;
  }

  private toSeriesEntry(raw: unknown): SeriesEntry | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const obj = raw as Record<string, unknown>;
    const id = obj.id;
    const title = obj.title;
    if (typeof id !== "string" || typeof title !== "string") return undefined;

    const genres = Array.isArray(obj.genres)
      ? obj.genres.filter((g): g is string => typeof g === "string")
      : undefined;

    const chapters = Array.isArray(obj.chapters)
      ? obj.chapters
          .map((c) => this.toChapterEntry(c))
          .filter((c): c is ChapterEntry => c !== undefined)
      : undefined;

    return {
      id,
      title,
      coverImage:
        typeof obj.coverImage === "string" ? obj.coverImage : undefined,
      status: typeof obj.status === "string" ? obj.status : undefined,
      description:
        typeof obj.description === "string" ? obj.description : undefined,
      author: typeof obj.author === "string" ? obj.author : undefined,
      artist: typeof obj.artist === "string" ? obj.artist : undefined,
      genres,
      chapters,
    };
  }

  private toChapterEntry(raw: unknown): ChapterEntry | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const obj = raw as Record<string, unknown>;
    const id = obj.id;
    const number = obj.number;
    if (typeof id !== "string" || typeof number !== "number") return undefined;

    return {
      id,
      number,
      title: typeof obj.title === "string" ? obj.title : undefined,
      releaseDate:
        typeof obj.releaseDate === "string" ? obj.releaseDate : undefined,
      accessRoles: Array.isArray(obj.accessRoles)
        ? obj.accessRoles.filter((r): r is string => typeof r === "string")
        : undefined,
    };
  }

  // ----------------------------------------------------------------
  // RSC (Next.js flight) parsing
  // ----------------------------------------------------------------

  // The RSC flight body is a series of `<hexId>:<value>` rows. Most rows are
  // JSON arrays/objects; binary rows take the form `<hexId>:T<hexLen>,<content>`.
  // We extract every JSON chunk and recursively search for the object matching
  // the given predicate.
  private findRscObject(
    body: string,
    predicate: (obj: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    for (const chunk of this.extractRscChunks(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(chunk);
      } catch {
        continue;
      }
      const found = this.searchJson(parsed, predicate);
      if (found) return found;
    }
    return undefined;
  }

  private extractRscChunks(body: string): string[] {
    const chunks: string[] = [];
    let pos = 0;

    while (pos < body.length) {
      const colonIdx = body.indexOf(":", pos);
      if (colonIdx === -1) break;

      const id = body.substring(pos, colonIdx);
      if (id.length === 0 || !/^[0-9a-fA-F]+$/.test(id)) {
        pos = colonIdx + 1;
        continue;
      }

      pos = colonIdx + 1;
      if (pos >= body.length) break;

      if (body[pos] === "T") {
        // Binary chunk: T<hexLen>,<content> — skip its content, not JSON.
        pos++;
        const commaIdx = body.indexOf(",", pos);
        if (commaIdx === -1) break;
        const byteLen = parseInt(body.substring(pos, commaIdx), 16);
        pos = commaIdx + 1;
        if (Number.isNaN(byteLen)) break;
        let bytes = 0;
        while (pos < body.length && bytes < byteLen) {
          const code = body.charCodeAt(pos);
          if (code < 0x80) bytes += 1;
          else if (code < 0x800) bytes += 2;
          else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            pos++;
          } else bytes += 3;
          pos++;
        }
      } else {
        const end = this.scanJsonEnd(body, pos);
        if (end > pos) {
          chunks.push(body.substring(pos, end));
        }
        pos = end > pos ? end : pos + 1;
      }
    }

    return chunks;
  }

  // Returns the index immediately after the JSON value that starts at `start`.
  private scanJsonEnd(body: string, start: number): number {
    let depth = 0;
    let inString = false;
    let escape = false;
    let i = start;

    while (i < body.length) {
      const c = body[i++];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\" && inString) {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{" || c === "[") {
        depth++;
      } else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return i;
      } else if (depth === 0 && /\s/.test(c)) {
        return i - 1;
      }
    }
    return i;
  }

  private searchJson(
    value: unknown,
    predicate: (obj: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = this.searchJson(child, predicate);
        if (found) return found;
      }
      return undefined;
    }
    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (predicate(obj)) return obj;
      for (const key of Object.keys(obj)) {
        const found = this.searchJson(obj[key], predicate);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/series/${slug.replace(/^\/+/, "")}`;
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

  private parseStatus(status?: string): string {
    switch ((status || "").toLowerCase()) {
      case "ongoing":
        return "Ongoing";
      case "completed":
        return "Completed";
      case "hiatus":
        return "Hiatus";
      default:
        return "Unknown";
    }
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  }

  private coverUrl(coverImage?: string): string {
    if (!coverImage) return "";
    return this.absoluteUrl(coverImage);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
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

  async fetchString(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
  }
}

export const RevivalScans = new RevivalScansExtension();
