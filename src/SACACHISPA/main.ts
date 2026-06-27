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

const BASE_URL = "https://sacachispa.site";
const PAGE_SIZE = 24;

interface SACACHISPAMetadata {
  page?: number;
}

// ---- Upstream JSON / RSC shapes ----

interface SeriesDto {
  title?: string;
  slug?: string;
  description?: string | null;
  cover_image_url?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string[];
}

interface SeriesResponseDto {
  items?: SeriesDto[];
  page?: number;
  totalPages?: number;
}

interface ChapterDto {
  chapter_number?: number;
  title?: string | null;
  created_at?: string | null;
  pages?: string[];
}

// Generic JSON value type for the resolved RSC tree.
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

class SACACHISPAInterceptor extends PaperbackInterceptor {
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

type SACACHISPAImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class SACACHISPAExtension implements SACACHISPAImplementation {
  requestManager = new SACACHISPAInterceptor("main");
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
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as SACACHISPAMetadata | undefined;
    const page = meta?.page ?? 1;

    const url = `${BASE_URL}/api/series?page=${page}&pageSize=${PAGE_SIZE}`;
    const dto = await this.fetchJson<SeriesResponseDto>({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    for (const series of dto.items ?? []) {
      const parsed = this.parseSeries(series);
      if (!parsed) continue;
      items.push({
        type: "featuredCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    }

    const hasNext = (dto.page ?? page) < (dto.totalPages ?? page);
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as SACACHISPAMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const url =
      `${BASE_URL}/api/series?page=${page}&pageSize=${PAGE_SIZE}` +
      `&search=${encodeURIComponent(titleQuery)}`;
    const dto = await this.fetchJson<SeriesResponseDto>({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    for (const series of dto.items ?? []) {
      const parsed = this.parseSeries(series);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = (dto.page ?? page) < (dto.totalPages ?? page);
    return {
      items: results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private parseSeries(
    series: SeriesDto,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const slug = (series.slug || "").trim();
    const title = (series.title || "").trim();
    if (!slug || !title) return undefined;
    return {
      mangaId: this.toSafeId(slug),
      imageUrl: this.absoluteUrl(series.cover_image_url || ""),
      title,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h1.font-heading").first().text().trim() || this.safeDecode(mangaId);
    const synopsis = $("p.max-w-2xl").first().text().trim();

    const authorRaw = $("span:contains(Author:)").first().text().trim();
    const author = authorRaw.includes("Author:")
      ? authorRaw.split("Author:")[1]?.trim()
      : undefined;
    const artistRaw = $("span:contains(Artist:)").first().text().trim();
    const artist = artistRaw.includes("Artist:")
      ? artistRaw.split("Artist:")[1]?.trim()
      : undefined;

    let statusText = "";
    $("span[data-slot=badge]").each((_, el) => {
      const t = $(el).text().trim().toLowerCase();
      if (!statusText && (t === "ongoing" || t === "completed")) {
        statusText = t;
      }
    });

    const genres = $("a[href^='/browse?genre='] span")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const thumbnailUrl = this.absoluteUrl(
      $("div.aspect-\\[2\\/3\\] img").first().attr("src") || "",
    );

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
        author: author || undefined,
        artist: artist || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId).replace(/^\/+|\/+$/g, "");
    const url = this.mangaUrl(sourceManga.mangaId);
    const html = await this.fetchHtml({ url, method: "GET" });

    const found = this.extractNextJs(
      html,
      (el) =>
        this.isObject(el) &&
        "chapters" in el &&
        Array.isArray((el as { chapters?: unknown }).chapters),
    ) as { chapters?: ChapterDto[] } | undefined;

    const rawChapters = found?.chapters ?? [];

    const chapters: Chapter[] = rawChapters.map((c) => {
      const num = c.chapter_number ?? 0;
      const numberStr = this.formatNumber(num);
      const chapterPath = `/series/${slug}/chapter/${numberStr}`;
      const title =
        c.title && c.title.trim().length > 0
          ? `Chapter ${numberStr} - ${c.title.trim()}`
          : `Chapter ${numberStr}`;
      return {
        chapterId: this.toSafeId(chapterPath.replace(/^\/+/, "")),
        sourceManga,
        title,
        volume: 0,
        chapNum: num,
        publishDate: this.parseDate(c.created_at),
        langCode: "🇬🇧",
      };
    });

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const html = await this.fetchHtml({ url, method: "GET" });

    const found = this.extractNextJs(html, (el) => {
      if (!this.isObject(el)) return false;
      const ch = (el as { chapter?: unknown }).chapter;
      return this.isObject(ch) && Array.isArray((ch as ChapterDto).pages);
    }) as { chapter?: ChapterDto } | undefined;

    const rawPages = found?.chapter?.pages ?? [];
    const pages = rawPages
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => this.absoluteUrl(p));

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
  // Next.js RSC extraction (ported from keiyoushi NextJs util)
  // ----------------------------------------------------------------

  private extractNextJs(
    html: string,
    predicate: (el: JsonValue) => boolean,
  ): JsonValue | undefined {
    const $ = cheerio.load(html);
    const chunkCache: Record<string, string> = {};
    const modelCache: Record<string, JsonValue> = {};
    const payloads: JsonValue[] = [];

    const nextFRegex = /self\.__next_f\.push\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/;

    $("script:not([src])").each((_, el) => {
      const script = $(el).text();
      if (!script.includes("self.__next_f.push")) return;
      const match = script.match(nextFRegex);
      if (!match) return;
      try {
        const arr = JSON.parse(match[1]) as JsonValue;
        if (!Array.isArray(arr) || arr.length < 2) return;
        const content = arr[1];
        if (typeof content !== "string") return;
        for (const payload of this.extractRscPayloads(
          content,
          chunkCache,
          modelCache,
        )) {
          payloads.push(payload);
        }
      } catch {
        // ignore malformed scripts
      }
    });

    for (const payload of payloads) {
      const resolved = this.resolveRefs(payload, chunkCache, modelCache, []);
      const result = this.findValue(resolved, predicate);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  private extractRscPayloads(
    body: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, JsonValue>,
  ): JsonValue[] {
    const results: JsonValue[] = [];
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
            pos++; // consume high surrogate; loop increment handles the low
          } else {
            bytes += 3;
          }
          pos++;
        }
        const chunkContent = body.substring(start, pos);
        chunkCache[id] = chunkContent;
        try {
          results.push(JSON.parse(chunkContent) as JsonValue);
        } catch {
          // not JSON, just a text chunk
        }
      } else {
        const { element, end } = this.parseJsonAt(body, pos);
        if (element !== undefined) {
          results.push(element);
          modelCache[id] = element;
        }
        pos = end;
      }
    }

    return results;
  }

  private parseJsonAt(
    body: string,
    start: number,
  ): { element: JsonValue | undefined; end: number } {
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
            return {
              element: JSON.parse(body.substring(start, i)) as JsonValue,
              end: i,
            };
          } catch {
            return { element: undefined, end: i };
          }
        }
      }
      if (depth === 0 && /\s/.test(c)) {
        try {
          return {
            element: JSON.parse(body.substring(start, i - 1)) as JsonValue,
            end: i,
          };
        } catch {
          return { element: undefined, end: i };
        }
      }
    }
    return { element: undefined, end: i };
  }

  private resolveRefs(
    element: JsonValue,
    chunkCache: Record<string, string>,
    modelCache: Record<string, JsonValue>,
    resolving: string[],
  ): JsonValue {
    if (Array.isArray(element)) {
      return element.map((e) =>
        this.resolveRefs(e, chunkCache, modelCache, resolving),
      );
    }
    if (this.isObject(element)) {
      const out: { [key: string]: JsonValue } = {};
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
    if (
      typeof element === "string" &&
      element.startsWith("$") &&
      element.length >= 2
    ) {
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
      if (second === "$") return str.substring(1); // escaped '$'
      if (second === "D") return str.substring(2); // date
      if (second === "n") return str.substring(2); // bigint
      if (second === "Q") {
        const r = this.resolveMapRef(
          str.substring(2),
          chunkCache,
          modelCache,
          resolving,
        );
        return r ?? element;
      }
      if (second === "W") {
        const r = this.resolveSetRef(
          str.substring(2),
          chunkCache,
          modelCache,
          resolving,
        );
        return r ?? element;
      }
      const r = this.resolveModelRef(
        str.substring(1),
        chunkCache,
        modelCache,
        resolving,
      );
      return r ?? element;
    }
    return element;
  }

  private resolveModelRef(
    reference: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, JsonValue>,
    resolving: string[],
  ): JsonValue | undefined {
    const segments = reference.split(":");
    const id = segments[0];
    if (segments.length === 1 && chunkCache[id] !== undefined) {
      return chunkCache[id];
    }
    if (resolving.includes(id)) return undefined;
    const guard = [...resolving, id];
    let value: JsonValue | undefined = modelCache[id];
    if (value === undefined) return undefined;
    for (let i = 1; i < segments.length; i++) {
      if (typeof value === "string" && value.startsWith("$")) {
        value = this.resolveRefs(value, chunkCache, modelCache, guard);
      }
      value = this.walkRefSegment(value, segments[i]);
      if (value === undefined) return undefined;
    }
    return this.resolveRefs(value as JsonValue, chunkCache, modelCache, guard);
  }

  private walkRefSegment(
    value: JsonValue,
    segment: string,
  ): JsonValue | undefined {
    if (Array.isArray(value)) {
      if (value.length >= 4 && value[0] === "$") {
        if (segment === "type") return value[1];
        if (segment === "key") return value[2];
        if (segment === "props") return value[3];
        const idx = parseInt(segment, 10);
        return Number.isNaN(idx) ? undefined : value[idx];
      }
      const idx = parseInt(segment, 10);
      return Number.isNaN(idx) ? undefined : value[idx];
    }
    if (this.isObject(value)) {
      return value[segment];
    }
    return undefined;
  }

  private resolveMapRef(
    id: string,
    chunkCache: Record<string, string>,
    modelCache: Record<string, JsonValue>,
    resolving: string[],
  ): JsonValue | undefined {
    if (resolving.includes(id)) return undefined;
    const entries = modelCache[id];
    if (!Array.isArray(entries)) return undefined;
    const resolved = this.resolveRefs(entries, chunkCache, modelCache, [
      ...resolving,
      id,
    ]);
    if (!Array.isArray(resolved)) return undefined;
    const out: { [key: string]: JsonValue } = {};
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
    modelCache: Record<string, JsonValue>,
    resolving: string[],
  ): JsonValue | undefined {
    if (resolving.includes(id)) return undefined;
    const values = modelCache[id];
    if (!Array.isArray(values)) return undefined;
    return this.resolveRefs(values, chunkCache, modelCache, [...resolving, id]);
  }

  private findValue(
    payload: JsonValue,
    predicate: (el: JsonValue) => boolean,
  ): JsonValue | undefined {
    if (!Array.isArray(payload) && !this.isObject(payload)) return undefined;
    if (predicate(payload)) return payload;
    const children: JsonValue[] = Array.isArray(payload)
      ? payload
      : Object.values(payload);
    for (const child of children) {
      const result = this.findValue(child, predicate);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  private isObject(value: unknown): value is { [key: string]: JsonValue } {
    return (
      typeof value === "object" && value !== null && !Array.isArray(value)
    );
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

  private formatNumber(num: number): string {
    // Mirrors Kotlin's chapterNumber.toString().removeSuffix(".0")
    return String(num);
  }

  private parseDate(date: string | null | undefined): Date {
    if (!date) return new Date(0);
    const t = Date.parse(date);
    if (Number.isNaN(t)) return new Date(0);
    return new Date(t);
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
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
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

  async fetchHtml(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
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

export const SACACHISPA = new SACACHISPAExtension();
