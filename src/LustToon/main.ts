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

const BASE_URL = "https://lustoon.com";
const API_URL = "https://back.lustoon.com";

// Genre options ported from the upstream Filters.kt (id -> label).
const GENRES: { id: string; title: string }[] = [
  { id: "1", title: "Action" },
  { id: "2", title: "Adventure" },
  { id: "3", title: "Animation" },
  { id: "4", title: "Apocalyptic" },
  { id: "5", title: "Boys Love" },
  { id: "6", title: "Comedy" },
  { id: "7", title: "Crime" },
  { id: "8", title: "Cyberpunk" },
  { id: "9", title: "Demons" },
  { id: "10", title: "Drama" },
  { id: "11", title: "Ecchi" },
  { id: "12", title: "Family" },
  { id: "13", title: "Fantasy" },
  { id: "14", title: "Foreign" },
  { id: "15", title: "Gender Bender" },
  { id: "16", title: "Girls Love" },
  { id: "17", title: "Gore" },
  { id: "18", title: "Harem" },
  { id: "19", title: "History" },
  { id: "20", title: "Horror" },
  { id: "21", title: "Kids" },
  { id: "22", title: "Magic" },
  { id: "23", title: "Martial Arts" },
  { id: "24", title: "Mecha" },
  { id: "25", title: "Military" },
  { id: "26", title: "Mystery" },
  { id: "27", title: "Music" },
  { id: "28", title: "Parody" },
  { id: "29", title: "Police" },
  { id: "30", title: "Psychological" },
  { id: "31", title: "Reality" },
  { id: "32", title: "Reincarnation" },
  { id: "33", title: "Romance" },
  { id: "34", title: "Samurai" },
  { id: "35", title: "School Life" },
  { id: "36", title: "Sci-Fi" },
  { id: "37", title: "Slice of Life" },
  { id: "38", title: "Soap Opera" },
  { id: "39", title: "Sports" },
  { id: "40", title: "Supernatural" },
  { id: "41", title: "Super Power" },
  { id: "42", title: "Survival" },
  { id: "43", title: "Thriller" },
  { id: "44", title: "Tragedy" },
  { id: "45", title: "Vampires" },
  { id: "46", title: "Virtual Reality" },
  { id: "47", title: "War" },
  { id: "48", title: "Western" },
  { id: "49", title: "Dungeon" },
  { id: "50", title: "Systems" },
  { id: "51", title: "Revenge" },
  { id: "52", title: "Regression" },
  { id: "53", title: "Isekai" },
  { id: "54", title: "Video Games" },
  { id: "55", title: "Villainess" },
  { id: "56", title: "Adult" },
  { id: "57", title: "Smut" },
  { id: "58", title: "Transmigration" },
  { id: "59", title: "Ghosts" },
  { id: "60", title: "Dragons" },
  { id: "61", title: "Beasts" },
  { id: "62", title: "Aliens" },
  { id: "63", title: "Omegaverse" },
];

interface LustToonMetadata {
  page?: number;
  genre?: string;
}

interface SearchItemDto {
  name?: string | null;
  slug?: string | null;
  urlImg?: string | null;
}

interface MetaDto {
  current_page?: number;
  last_page?: number;
}

interface SearchResponseDto {
  data?: SearchItemDto[];
  meta?: MetaDto | null;
}

interface ChapterDto {
  slug?: string | null;
  num?: number | null;
  name?: string | null;
  createdAt?: string | null;
}

interface SerieDto {
  name?: string | null;
  slug?: string | null;
  urlImg?: string | null;
  sinopsis?: string | null;
  state?: { estado?: string | null } | null;
  genders?: { name?: string | null }[] | null;
  chapters?: ChapterDto[] | null;
}

class LustToonInterceptor extends PaperbackInterceptor {
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

type LustToonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class LustToonExtension implements LustToonImplementation {
  requestManager = new LustToonInterceptor("main");
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
        searchQuery: { title: "", metadata: { genre: g.id } },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as LustToonMetadata | undefined;
    const page = meta?.page ?? 1;
    const orderBy = section.id === "popular" ? "6" : "3";
    const url = this.filterUrl({ page, orderBy });

    const resp = await this.fetchJson<SearchResponseDto>({ url, method: "GET" });
    const data = resp.data ?? [];
    const items: DiscoverSectionItem[] = [];
    for (const item of data) {
      const parsed = this.itemToResult(item);
      if (!parsed) continue;
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
    }

    const hasNext = this.hasNext(resp.meta);
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    // Text search uses a dedicated endpoint that returns a flat list (no paging).
    if (titleQuery !== "") {
      const url = `${API_URL}/home/buscar?query=${encodeURIComponent(titleQuery)}`;
      const items = await this.fetchJson<SearchItemDto[]>({ url, method: "GET" });
      const results: SearchResultItem[] = [];
      for (const item of items ?? []) {
        const parsed = this.itemToResult(item);
        if (!parsed) continue;
        results.push({
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
      return { items: results, metadata: undefined };
    }

    const meta = metadata as LustToonMetadata | undefined;
    const page = meta?.page ?? 1;
    const queryMeta = query.metadata as LustToonMetadata | undefined;
    const genre = meta?.genre ?? queryMeta?.genre ?? "";

    const url = this.filterUrl({ page, orderBy: "1", genre });
    const resp = await this.fetchJson<SearchResponseDto>({ url, method: "GET" });
    const data = resp.data ?? [];
    const results: SearchResultItem[] = [];
    for (const item of data) {
      const parsed = this.itemToResult(item);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = this.hasNext(resp.meta);
    return {
      items: results,
      metadata: hasNext ? { page: page + 1, genre } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({
      url,
      method: "GET",
      headers: { RSC: "1" },
    });

    const serie = this.extractSerie($);

    const title = (serie?.name ?? "").trim() || this.slugTitle(mangaId);
    const thumbnailUrl = this.httpsUrl(serie?.urlImg ?? "");
    const synopsis = (serie?.sinopsis ?? "").trim();

    const genres = (serie?.genders ?? [])
      .map((g) => (g?.name ?? "").trim())
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

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(serie?.state?.estado ?? ""),
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
    const $ = await this.fetchCheerio({
      url,
      method: "GET",
      headers: { RSC: "1" },
    });

    const serie = this.extractSerie($);
    const mangaSlug = serie?.slug;
    if (!serie || !mangaSlug) return [];

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const chapter of serie.chapters ?? []) {
      const slug = chapter.slug;
      if (!slug) continue;
      const chapterId = this.parsePath(`/comic/${mangaSlug}/${slug}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const num = typeof chapter.num === "number" ? chapter.num : -1;
      const chapName = (chapter.name ?? "").trim();
      const title =
        chapName !== "" && /\d/.test(chapName)
          ? chapName
          : `Chapter ${num >= 0 ? String(num).replace(/\.0$/, "") : ""}`.trim();

      chapters.push({
        chapterId,
        sourceManga,
        title,
        volume: 0,
        chapNum: num >= 0 ? num : 0,
        publishDate: this.parseDate(chapter.createdAt ?? ""),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div.max-w-4xl img").each((_, element) => {
      const src = $(element).attr("src") || "";
      if (!src) return;
      pages.push(this.httpsUrl(this.absoluteUrl(src)));
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
  // API helpers
  // ----------------------------------------------------------------

  private filterUrl(opts: {
    page: number;
    orderBy: string;
    genre?: string;
  }): string {
    const params = [
      `page=${opts.page}`,
      `limit=24`,
      `orderBy=${opts.orderBy}`,
      `sort=desc`,
      `gendersId=${encodeURIComponent(opts.genre ?? "")}`,
      `origin=`,
      `state=`,
      `loading=true`,
    ];
    return `${API_URL}/filtrar?${params.join("&")}`;
  }

  private itemToResult(
    item: SearchItemDto,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    if (!item.slug) return undefined;
    const mangaId = this.parsePath(`/comic/${item.slug}`);
    return {
      mangaId,
      imageUrl: this.httpsUrl(item.urlImg ?? ""),
      title: (item.name ?? "").trim(),
    };
  }

  private hasNext(meta: MetaDto | null | undefined): boolean {
    const current = meta?.current_page ?? 1;
    const last = meta?.last_page ?? 1;
    return current < last;
  }

  // ----------------------------------------------------------------
  // Next.js RSC extraction (port of keiyoushi extractNextJs)
  // ----------------------------------------------------------------

  // Walks the inline `self.__next_f.push` flight chunks, resolves RSC model
  // references, and returns the first object carrying both `slug` and
  // `chapters` keys (the upstream predicate).
  private extractSerie($: CheerioAPI): SerieDto | undefined {
    const chunkCache = new Map<string, string>();
    const modelCache = new Map<string, unknown>();
    const payloads: unknown[] = [];

    $("script:not([src])").each((_, el) => {
      const script = $(el).text() || "";
      if (!script.includes("self.__next_f.push")) return;
      const match = script.match(
        /self\.__next_f\.push\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/,
      );
      if (!match) return;
      let arr: unknown;
      try {
        arr = JSON.parse(match[1]);
      } catch {
        return;
      }
      if (!Array.isArray(arr) || typeof arr[1] !== "string") return;
      for (const p of this.extractRscPayloads(arr[1], chunkCache, modelCache)) {
        payloads.push(p);
      }
    });

    for (const payload of payloads) {
      const resolved = this.resolveRefs(payload, chunkCache, modelCache, []);
      const found = this.findSerie(resolved);
      if (found) return found;
    }
    return undefined;
  }

  private extractRscPayloads(
    body: string,
    chunkCache: Map<string, string>,
    modelCache: Map<string, unknown>,
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
        // Binary chunk: T<hexLen>,<content> (byteLen is UTF-8 byte length).
        pos++;
        const commaIdx = body.indexOf(",", pos);
        if (commaIdx === -1) break;
        const byteLen = parseInt(body.substring(pos, commaIdx), 16);
        if (Number.isNaN(byteLen)) break;
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
        chunkCache.set(id, chunkContent);
        try {
          results.push(JSON.parse(chunkContent));
        } catch {
          // ignore non-JSON binary chunks
        }
      } else {
        const [element, end] = this.parseJsonAt(body, pos);
        if (element !== undefined) {
          results.push(element);
          modelCache.set(id, element);
        }
        pos = end;
      }
    }

    return results;
  }

  private parseJsonAt(body: string, start: number): [unknown, number] {
    if (start >= body.length) return [undefined, start];

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
            return [JSON.parse(body.substring(start, i)), i];
          } catch {
            return [undefined, i];
          }
        }
      }
      if (depth === 0 && /\s/.test(c)) {
        try {
          return [JSON.parse(body.substring(start, i - 1)), i];
        } catch {
          return [undefined, i];
        }
      }
    }
    return [undefined, i];
  }

  private resolveRefs(
    element: unknown,
    chunkCache: Map<string, string>,
    modelCache: Map<string, unknown>,
    resolving: string[],
  ): unknown {
    if (Array.isArray(element)) {
      return element.map((e) =>
        this.resolveRefs(e, chunkCache, modelCache, resolving),
      );
    }
    if (element && typeof element === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(element as Record<string, unknown>)) {
        out[k] = this.resolveRefs(v, chunkCache, modelCache, resolving);
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
      const second = str[1];
      if (second === "$") return str.substring(1);
      if (second === "D") return str.substring(2);
      if (second === "n") return str.substring(2);
      // Outlined model reference: `$<id>` or `$<id>:<path>`.
      const resolved = this.resolveModelRef(
        str.substring(1),
        chunkCache,
        modelCache,
        resolving,
      );
      return resolved === undefined ? element : resolved;
    }
    return element;
  }

  private resolveModelRef(
    reference: string,
    chunkCache: Map<string, string>,
    modelCache: Map<string, unknown>,
    resolving: string[],
  ): unknown {
    const segments = reference.split(":");
    const id = segments[0];
    if (segments.length === 1) {
      const chunk = chunkCache.get(id);
      if (chunk !== undefined) return chunk;
    }
    if (resolving.includes(id)) return undefined;
    const guard = [...resolving, id];
    if (!modelCache.has(id)) return undefined;
    let value: unknown = modelCache.get(id);
    for (let i = 1; i < segments.length; i++) {
      if (
        typeof value === "string" &&
        value.startsWith("$")
      ) {
        value = this.resolveRefs(value, chunkCache, modelCache, guard);
      }
      value = this.walkSegment(value, segments[i]);
      if (value === undefined) return undefined;
    }
    return this.resolveRefs(value, chunkCache, modelCache, guard);
  }

  private walkSegment(value: unknown, segment: string): unknown {
    if (Array.isArray(value)) {
      if (value.length >= 4 && value[0] === "$") {
        if (segment === "type") return value[1];
        if (segment === "key") return value[2];
        if (segment === "props") return value[3];
      }
      const idx = parseInt(segment, 10);
      return Number.isNaN(idx) ? undefined : value[idx];
    }
    if (value && typeof value === "object") {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }

  private findSerie(element: unknown): SerieDto | undefined {
    if (Array.isArray(element)) {
      for (const child of element) {
        const found = this.findSerie(child);
        if (found) return found;
      }
      return undefined;
    }
    if (element && typeof element === "object") {
      const obj = element as Record<string, unknown>;
      if ("slug" in obj && "chapters" in obj) {
        return obj as SerieDto;
      }
      for (const child of Object.values(obj)) {
        const found = this.findSerie(child);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ----------------------------------------------------------------
  // URL / id helpers
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

  private slugTitle(mangaId: string): string {
    const slug = this.safeDecode(mangaId).replace(/^.*\//, "");
    return slug.replace(/[-_]+/g, " ").trim() || slug;
  }

  private httpsUrl(src: string): string {
    return (src || "").replace(/^http:\/\//, "https://");
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
    if (s.includes("en emision") || s.includes("ongoing")) return "Ongoing";
    if (
      s.includes("completado") ||
      s.includes("finalizado") ||
      s.includes("completed")
    ) {
      return "Completed";
    }
    if (s.includes("cancelado") || s.includes("cancelled")) return "Cancelled";
    if (s.includes("pausado") || s.includes("hiatus") || s.includes("paused")) {
      return "Hiatus";
    }
    return "Unknown";
  }

  private parseDate(raw: string): Date {
    const trimmed = (raw || "").split("+")[0].split("Z")[0].trim();
    if (!trimmed) return new Date(0);
    const parsed = new Date(`${trimmed}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return new Date(0);
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

export const LustToon = new LustToonExtension();
