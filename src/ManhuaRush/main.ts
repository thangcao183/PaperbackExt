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

const BASE_URL = "https://manhuarush.vercel.app";

// This is effectively a single-series source: the site hosts one manga,
// linked from the homepage nav as /ttp-providence.
const MANGA_ID = "ttp-providence";
const TITLE = "Top Tier Providence: I Secretly Cultivated for 1,000 Years";
const THUMBNAIL = `${BASE_URL}/api/mangadex-proxy/covers/c089b50c-beeb-434a-ab8d-2676dc026564/1b68d2fc-8e1c-4703-8daa-2e8228d5ad6c.jpg`;

interface ChapterEntry {
  chapter: string;
  title: string;
  createdAt?: string;
}

class ManhuaRushInterceptor extends PaperbackInterceptor {
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

type ManhuaRushImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ManhuaRushExtension implements ManhuaRushImplementation {
  requestManager = new ManhuaRushInterceptor("main");
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
        title: "Manhua Rush",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = [
      {
        type: "featuredCarouselItem",
        mangaId: MANGA_ID,
        imageUrl: THUMBNAIL,
        title: TITLE,
        metadata: undefined,
      },
    ];
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const items: SearchResultItem[] = [];
    if (titleQuery === "" || TITLE.toLowerCase().includes(titleQuery)) {
      items.push({
        mangaId: MANGA_ID,
        imageUrl: THUMBNAIL,
        title: TITLE,
        subtitle: undefined,
        metadata: undefined,
      });
    }
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h1.manga-title").first().text().trim() || TITLE;
    const synopsis = $(".manga-desc p").first().text().trim();
    const thumbnailUrl =
      this.imageFromElement($(".cover img").first()) || THUMBNAIL;

    const genres = $(".tag-pill")
      .map((_, el) => $(el).text().trim())
      .get()
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
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
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
    // Chapters live in the Next.js RSC flight payload, requested with RSC: 1.
    const body = await this.fetchString({
      url,
      method: "GET",
      headers: { RSC: "1" },
    });

    const payload = this.findRscObject(
      body,
      (obj) => Array.isArray(obj.chapters) && typeof obj.mangadexId === "string",
    );

    if (!payload) {
      throw new Error("Failed to extract chapters");
    }

    const mangadexId = String(payload.mangadexId);
    const rawChapters = payload.chapters as unknown[];

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const raw of rawChapters) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as ChapterEntry;
      const chapter = entry.chapter;
      if (typeof chapter !== "string" || chapter.length === 0) continue;

      const chapterId = this.parsePath(`/reader/${mangadexId}/${chapter}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const titleText =
        typeof entry.title === "string" && entry.title.length > 0
          ? entry.title
          : "";
      const name = `Chapter ${chapter}${titleText ? ` - ${titleText}` : ""}`;

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: parseFloat(chapter) || 0,
        publishDate: this.parseDate(entry.createdAt),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const body = await this.fetchString({
      url,
      method: "GET",
      headers: { RSC: "1" },
    });

    const payload = this.findRscObject(
      body,
      (obj) => Array.isArray(obj.imageUrls),
    );

    const pages: string[] = [];
    if (payload) {
      for (const raw of payload.imageUrls as unknown[]) {
        if (typeof raw === "string" && raw.length > 0) {
          pages.push(this.absoluteUrl(raw));
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
  // RSC (Next.js flight) parsing
  // ----------------------------------------------------------------

  // The RSC flight body is a series of `<hexId>:<value>` rows. Most rows are
  // JSON arrays/objects; binary rows take the form `<hexId>:T<hexLen>,<content>`.
  // For this source the chapter list and image list sit inline as plain JSON,
  // so we extract every JSON chunk and recursively search for the object that
  // matches the given predicate.
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

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
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

export const ManhuaRush = new ManhuaRushExtension();
