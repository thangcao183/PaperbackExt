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

const BASE_URL = "https://www.team-shadowi.com";
const LIMIT = 20;

interface TeamShadowiMetadata {
  page?: number;
  genre?: string;
  sort?: string;
}

// Genre filter options ported from the upstream Kotlin GenreFilter.
const GENRES: { id: string; title: string }[] = [
  { id: "all", title: "All" },
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "isekai", title: "Isekai" },
  { id: "romance", title: "Romance" },
];

// JSON-API shapes (mirrors Dto.kt).
interface SeriesDto {
  title: string;
  slug: string;
  thumbnail_url?: string | null;
  status?: string | null;
  description?: string | null;
  genres?: string[] | null;
}

interface SeriesResponseDto {
  data?: SeriesDto[];
  hasMore?: boolean;
}

interface SearchResponseDto {
  series?: SeriesDto[];
}

class TeamShadowiInterceptor extends PaperbackInterceptor {
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

type TeamShadowiImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class TeamShadowiExtension implements TeamShadowiImplementation {
  requestManager = new TeamShadowiInterceptor("main");
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
      const items: DiscoverSectionItem[] = GENRES.filter(
        (g) => g.id !== "all",
      ).map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: g.id },
        },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as TeamShadowiMetadata | undefined;
    const page = meta?.page ?? 1;
    const offset = (page - 1) * LIMIT;
    const sortBy = section.id === "latest" ? "created" : "rating";
    const url = `${BASE_URL}/api/series/popular?timePeriod=all&genre=all&sortBy=${sortBy}&offset=${offset}&limit=${LIMIT}`;

    const res = await this.fetchJson<SeriesResponseDto>({ url, method: "GET" });
    const series = res.data ?? [];

    const items: DiscoverSectionItem[] = series.map((s) => ({
      type:
        section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem",
      mangaId: this.seriesId(s.slug),
      imageUrl: s.thumbnail_url ?? "",
      title: s.title,
      metadata: undefined,
    }));

    return {
      items,
      metadata: res.hasMore ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    // Text search endpoint: does not paginate.
    if (titleQuery !== "") {
      const url = `${BASE_URL}/api/search?q=${encodeURIComponent(titleQuery)}`;
      const res = await this.fetchJson<SearchResponseDto>({
        url,
        method: "GET",
      });
      const items: SearchResultItem[] = (res.series ?? []).map((s) => ({
        mangaId: this.seriesId(s.slug),
        imageUrl: s.thumbnail_url ?? "",
        title: s.title,
        subtitle: undefined,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    // Browse endpoint with genre/sort filters.
    const meta = metadata as TeamShadowiMetadata | undefined;
    const page = meta?.page ?? 1;
    const offset = (page - 1) * LIMIT;

    // On the first page take filters from the search query; on later pages
    // re-use the genre/sort carried in the pagination metadata.
    const queryFilters = this.readFilters(query);
    const genre = meta?.genre ?? queryFilters.genre;
    const sort = meta?.sort ?? queryFilters.sort;

    const url = `${BASE_URL}/api/series/popular?offset=${offset}&limit=${LIMIT}&timePeriod=all&genre=${encodeURIComponent(
      genre,
    )}&sortBy=${encodeURIComponent(sort)}`;

    const res = await this.fetchJson<SeriesResponseDto>({ url, method: "GET" });
    const series = res.data ?? [];
    const items: SearchResultItem[] = series.map((s) => ({
      mangaId: this.seriesId(s.slug),
      imageUrl: s.thumbnail_url ?? "",
      title: s.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items,
      metadata: res.hasMore ? { page: page + 1, genre, sort } : undefined,
    };
  }

  private readFilters(query: SearchQuery<Metadata>): {
    genre: string;
    sort: string;
  } {
    let genre = "all";
    let sort = "rating";
    const meta = query.metadata;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const g = (meta as { genre?: unknown }).genre;
      const s = (meta as { sort?: unknown }).sort;
      if (typeof g === "string" && g.length > 0) genre = g;
      if (typeof s === "string" && s.length > 0) sort = s;
    }
    return { genre, sort };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const payloads = await this.fetchRscPayloads({
      url,
      method: "GET",
      headers: { Rsc: "1" },
    });

    const node = this.findNode(
      payloads,
      (o) => "series" in o && this.isObject(o.series),
    );
    const seriesObj = node ? (node.series as Record<string, unknown>) : {};

    const title = this.asString(seriesObj.title) || this.safeDecode(mangaId);
    const synopsis = this.asString(seriesObj.description);
    const thumbnailUrl = this.asString(seriesObj.thumbnail_url);
    const status = this.parseStatus(this.asString(seriesObj.status));

    const genres = this.asStringArray(seriesObj.genres);
    const tags = this.asStringArray(seriesObj.tags);
    const allTags = Array.from(new Set([...genres, ...tags])).filter(
      (t) => t.length > 0,
    );

    const tagGroups: TagSection[] = [];
    if (allTags.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: allTags.map((t) => ({
          id: t.toLowerCase().replace(/\s+/g, "-"),
          title: t,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis,
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
    const url = this.mangaUrl(sourceManga.mangaId);
    const payloads = await this.fetchRscPayloads({
      url,
      method: "GET",
      headers: { Rsc: "1" },
    });

    const slug = this.slugFromId(sourceManga.mangaId);

    // Find the array of chapter objects (each has number; id/title/created_at).
    const chaptersNode = this.findArray(
      payloads,
      (arr) =>
        arr.length > 0 &&
        this.isObject(arr[0]) &&
        "number" in (arr[0] as Record<string, unknown>),
    );

    const raw = chaptersNode ?? [];
    const chapters: Chapter[] = [];
    for (const entry of raw) {
      if (!this.isObject(entry)) continue;
      const chap = entry as Record<string, unknown>;
      const numVal = chap.number;
      const chapNum =
        typeof numVal === "number"
          ? numVal
          : parseFloat(this.asString(numVal)) || 0;
      const numStr = this.trimZero(chapNum);
      const titleText = this.asString(chap.title);
      const name = titleText
        ? `Chapter ${numStr}: ${titleText}`
        : `Chapter ${numStr}`;
      const chapterId = this.toSafeId(`read/${slug}/${numStr}`);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum,
        publishDate: this.parseDate(this.asString(chap.created_at)),
        langCode: "🇬🇧",
      });
    }

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const payloads = await this.fetchRscPayloads({
      url,
      method: "GET",
      headers: { Rsc: "1" },
    });

    const node = this.findNode(payloads, (o) => Array.isArray(o.pages));
    const rawPages = node ? (node.pages as unknown[]) : [];
    const pages: string[] = [];
    for (const p of rawPages) {
      const src = this.asString(p);
      if (src) pages.push(this.absoluteUrl(src));
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
  // URL / id helpers
  // ----------------------------------------------------------------

  private seriesId(slug: string): string {
    return this.toSafeId(`series/${slug.replace(/^\/+/, "")}`);
  }

  private slugFromId(mangaId: string): string {
    const path = this.safeDecode(mangaId).replace(/^\/+/, "");
    const parts = path.split("/").filter((s) => s.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : path;
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

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    return "Unknown";
  }

  private trimZero(num: number): string {
    if (Number.isInteger(num)) return num.toString();
    return num.toString();
  }

  private parseDate(value: string): Date {
    if (!value) return new Date(0);
    const clean = value.split("+")[0].split("Z")[0];
    const d = new Date(`${clean}Z`);
    if (!isNaN(d.getTime())) return d;
    const d2 = new Date(value);
    return isNaN(d2.getTime()) ? new Date(0) : d2;
  }

  // ----------------------------------------------------------------
  // JSON value helpers
  // ----------------------------------------------------------------

  private isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  private asString(v: unknown): string {
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return v.toString();
    return "";
  }

  private asStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  }

  // ----------------------------------------------------------------
  // Next.js RSC parsing (ported from keiyoushi NextJs.kt)
  // ----------------------------------------------------------------

  // Recursively search the resolved payloads for an object matching the predicate.
  private findNode(
    payloads: unknown[],
    predicate: (o: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    for (const p of payloads) {
      const r = this.searchObject(p, predicate);
      if (r) return r;
    }
    return undefined;
  }

  private searchObject(
    node: unknown,
    predicate: (o: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    if (this.isObject(node)) {
      if (predicate(node)) return node;
      for (const key of Object.keys(node)) {
        const r = this.searchObject(node[key], predicate);
        if (r) return r;
      }
    } else if (Array.isArray(node)) {
      for (const child of node) {
        const r = this.searchObject(child, predicate);
        if (r) return r;
      }
    }
    return undefined;
  }

  private findArray(
    payloads: unknown[],
    predicate: (arr: unknown[]) => boolean,
  ): unknown[] | undefined {
    for (const p of payloads) {
      const r = this.searchArray(p, predicate);
      if (r) return r;
    }
    return undefined;
  }

  private searchArray(
    node: unknown,
    predicate: (arr: unknown[]) => boolean,
  ): unknown[] | undefined {
    if (Array.isArray(node)) {
      if (predicate(node)) return node;
      for (const child of node) {
        const r = this.searchArray(child, predicate);
        if (r) return r;
      }
    } else if (this.isObject(node)) {
      for (const key of Object.keys(node)) {
        const r = this.searchArray(node[key], predicate);
        if (r) return r;
      }
    }
    return undefined;
  }

  // Fetch a page with the Rsc header and return resolved RSC payload trees.
  private async fetchRscPayloads(request: Request): Promise<unknown[]> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const body = Application.arrayBufferToUTF8String(data);

    const chunkCache: Record<string, string> = {};
    const modelCache: Record<string, unknown> = {};

    let payloads = this.extractRscPayloads(body, chunkCache, modelCache);
    if (payloads.length === 0) {
      // HTML document: pull flight chunks from inline __next_f.push scripts.
      payloads = this.extractFromHtml(body, chunkCache, modelCache);
    }

    return payloads.map((p) => this.resolveRefs(p, chunkCache, modelCache, []));
  }

  private extractFromHtml(
    html: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, unknown>,
  ): unknown[] {
    const dom = htmlparser2.parseDocument(html);
    const $ = cheerio.load(dom);
    const results: unknown[] = [];
    const re = /self\.__next_f\.push\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/;
    $("script:not([src])").each((_, el) => {
      const script = $(el).text();
      if (!script.includes("self.__next_f.push")) return;
      const m = script.match(re);
      if (!m) return;
      try {
        const arr = JSON.parse(m[1]) as unknown[];
        const content = arr.length > 1 ? arr[1] : undefined;
        if (typeof content !== "string") return;
        for (const p of this.extractRscPayloads(
          content,
          chunkCache,
          modelCache,
        )) {
          results.push(p);
        }
      } catch {
        // ignore malformed scripts
      }
    });
    return results;
  }

  // Parse the raw RSC flight body into JSON payloads, populating the chunk/model caches.
  private extractRscPayloads(
    body: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, unknown>,
  ): unknown[] {
    const results: unknown[] = [];
    let pos = 0;

    while (pos < body.length) {
      const colonIdx = body.indexOf(":", pos);
      if (colonIdx === -1) break;

      const id = body.substring(pos, colonIdx);
      if (id.length === 0 || !/^[0-9a-fA-F]+$/.test(id)) {
        pos++;
        continue;
      }

      pos = colonIdx + 1;
      if (pos >= body.length) break;

      if (body[pos] === "T") {
        // Binary chunk: T<hexLen>,<content>; len is UTF-8 byte length.
        pos++;
        const commaIdx = body.indexOf(",", pos);
        if (commaIdx === -1) break;
        const byteLen = parseInt(body.substring(pos, commaIdx), 16);
        if (isNaN(byteLen)) break;
        pos = commaIdx + 1;
        let bytes = 0;
        const start = pos;
        while (pos < body.length && bytes < byteLen) {
          const code = body.charCodeAt(pos);
          if (code < 0x80) {
            bytes += 1;
          } else if (code < 0x800) {
            bytes += 2;
          } else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            pos++;
          } else {
            bytes += 3;
          }
          pos++;
        }
        const chunkContent = body.substring(start, pos);
        chunkCache[id] = chunkContent;
        try {
          results.push(JSON.parse(chunkContent));
        } catch {
          // not JSON
        }
      } else {
        const parsed = this.parseJsonAt(body, pos);
        if (parsed.element !== undefined) {
          results.push(parsed.element);
          modelCache[id] = parsed.element;
        }
        pos = parsed.end;
      }
    }

    return results;
  }

  private parseJsonAt(
    body: string,
    start: number,
  ): { element: unknown; end: number } {
    if (start >= body.length) return { element: undefined, end: start };

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
        if (--depth === 0) {
          try {
            return { element: JSON.parse(body.substring(start, i)), end: i };
          } catch {
            return { element: undefined, end: i };
          }
        }
      }
      if (depth === 0 && /\s/.test(c)) {
        try {
          return {
            element: JSON.parse(body.substring(start, i - 1)),
            end: i,
          };
        } catch {
          return { element: undefined, end: i };
        }
      }
    }
    return { element: undefined, end: i };
  }

  // Resolve React Flight `$`-references into concrete JSON.
  private resolveRefs(
    element: unknown,
    chunkCache: Record<string, string>,
    modelCache: Record<string, unknown>,
    resolving: string[],
  ): unknown {
    if (Array.isArray(element)) {
      return element.map((e) =>
        this.resolveRefs(e, chunkCache, modelCache, resolving),
      );
    }
    if (this.isObject(element)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(element)) {
        out[key] = this.resolveRefs(
          element[key],
          chunkCache,
          modelCache,
          resolving,
        );
      }
      return out;
    }
    if (typeof element === "string" && element.startsWith("$") && element.length >= 2) {
      const str = element;
      if (str === "$undefined") return null;
      if (
        str === "$Infinity" ||
        str === "$-Infinity" ||
        str === "$NaN" ||
        str === "$-0"
      ) {
        return str.substring(1);
      }
      const c = str[1];
      if (c === "$") return str.substring(1);
      if (c === "D") return str.substring(2);
      if (c === "n") return str.substring(2);
      if (c === "Q") {
        const r = this.resolveMapRef(
          str.substring(2),
          chunkCache,
          modelCache,
          resolving,
        );
        return r !== undefined ? r : element;
      }
      if (c === "W") {
        const r = this.resolveSetRef(
          str.substring(2),
          chunkCache,
          modelCache,
          resolving,
        );
        return r !== undefined ? r : element;
      }
      const r = this.resolveModelRef(
        str.substring(1),
        chunkCache,
        modelCache,
        resolving,
      );
      return r !== undefined ? r : element;
    }
    return element;
  }

  private resolveModelRef(
    reference: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, unknown>,
    resolving: string[],
  ): unknown {
    const segments = reference.split(":");
    const id = segments[0];
    if (segments.length === 1 && id in chunkCache) {
      return chunkCache[id];
    }
    if (resolving.includes(id)) return undefined;
    const guard = [...resolving, id];
    if (!(id in modelCache)) return undefined;
    let value: unknown = modelCache[id];
    for (let i = 1; i < segments.length; i++) {
      if (
        typeof value === "string" &&
        value.startsWith("$")
      ) {
        value = this.resolveRefs(value, chunkCache, modelCache, guard);
      }
      value = this.walkRefSegment(value, segments[i]);
      if (value === undefined) return undefined;
    }
    return this.resolveRefs(value, chunkCache, modelCache, guard);
  }

  private walkRefSegment(value: unknown, segment: string): unknown {
    if (this.isObject(value)) {
      return value[segment];
    }
    if (Array.isArray(value)) {
      if (value.length >= 4 && value[0] === "$") {
        if (segment === "type") return value[1];
        if (segment === "key") return value[2];
        if (segment === "props") return value[3];
      }
      const idx = parseInt(segment, 10);
      return isNaN(idx) ? undefined : value[idx];
    }
    return undefined;
  }

  private resolveMapRef(
    id: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, unknown>,
    resolving: string[],
  ): unknown {
    if (resolving.includes(id)) return undefined;
    const entries = modelCache[id];
    if (!Array.isArray(entries)) return undefined;
    const resolved = this.resolveRefs(entries, chunkCache, modelCache, [
      ...resolving,
      id,
    ]);
    if (!Array.isArray(resolved)) return undefined;
    const out: Record<string, unknown> = {};
    for (const pair of resolved) {
      if (Array.isArray(pair) && pair.length === 2) {
        const key =
          typeof pair[0] === "string" ? pair[0] : String(pair[0]);
        out[key] = pair[1];
      }
    }
    return out;
  }

  private resolveSetRef(
    id: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, unknown>,
    resolving: string[],
  ): unknown {
    if (resolving.includes(id)) return undefined;
    const values = modelCache[id];
    if (!Array.isArray(values)) return undefined;
    return this.resolveRefs(values, chunkCache, modelCache, [
      ...resolving,
      id,
    ]);
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
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

export const TeamShadowi = new TeamShadowiExtension();
