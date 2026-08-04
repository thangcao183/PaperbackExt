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
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { MangaKSearchForm, type MangaKSearchMeta } from "./forms";
import {
  getBlacklist,
  getCachedGenres,
  MangaKSettingsForm,
  setCachedGenres,
  type MangaKGenre,
} from "./settings";

const PAGE_LIMIT = 24;
const QUERY_LENGTH_LIMIT = 50;
// Image hosts that intermittently fail; upstream retries them on a mirror.
const IMAGE_FALLBACK_HOST_REGEX = /^rx\.qvzr[a-z]\.org$/;
const FALLBACK_IMAGE_HOST = "rx.rzyn.net";

export interface MangaKConfig {
  name: string;
  baseUrl: string;
  apiUrl?: string;
  contentRating?: ContentRating;
  langCode?: string;
}

interface MangaKMetadata {
  page?: number;
}

// ----------------------------------------------------------------
// JSON API shapes (api.<host>/titles/search, /chapters, /genres)
// ----------------------------------------------------------------

interface SearchItemDto {
  id?: string;
  name?: string;
  cover?: string;
  url?: string;
}

interface SearchResponseDto {
  data?: {
    items?: SearchItemDto[];
    pagination?: { has_next?: boolean };
  };
}

interface ChapterItemDto {
  url?: string;
  name?: string;
  updated_at?: string;
  chapter_number?: number;
}

interface ChapterListResponseDto {
  data?: {
    chapters?: ChapterItemDto[];
  };
}

interface GenreItemDto {
  name?: string;
  slug?: string;
}

interface GenreListResponseDto {
  data?: {
    items?: GenreItemDto[];
  };
}

// ----------------------------------------------------------------
// Next.js RSC shapes (pageProps embedded in the HTML page)
// ----------------------------------------------------------------

interface EntityDto {
  name?: string;
}

interface InitialMangaDto {
  id?: string;
  name?: string;
  authors?: EntityDto[];
  summary?: string;
  genres?: EntityDto[];
  status?: string;
  cover?: string;
}

interface InitialChapterDto {
  images?: string[];
}

interface PageProps {
  initialManga?: InitialMangaDto;
  initialChapter?: InitialChapterDto;
}

class MangaKInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly baseUrl: string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${this.baseUrl}/`,
      origin: this.baseUrl,
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

    // Some image CDN hosts fail intermittently; retry them on the mirror.
    if (response.status >= 400) {
      const retryUrl = mirrorImageUrl(request.url);
      if (retryUrl) {
        const [, retryData] = await Application.scheduleRequest({
          ...request,
          url: retryUrl,
        });
        return retryData;
      }
    }

    return data;
  }
}

// Rewrites `https://rx.qvzrX.org/...` to the mirror host, or returns undefined
// when the URL is not one of the flaky image hosts.
function mirrorImageUrl(url: string): string | undefined {
  const match = url.match(/^(https?:\/\/)([^/]+)(.*)$/);
  if (!match) return undefined;
  if (!IMAGE_FALLBACK_HOST_REGEX.test(match[2])) return undefined;
  return `${match[1]}${FALLBACK_IMAGE_HOST}${match[3]}`;
}

type MangaKImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaKExtension implements MangaKImplementation {
  readonly sourceName: string;
  readonly baseUrl: string;
  readonly apiUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  requestManager: MangaKInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  constructor(config: MangaKConfig) {
    this.sourceName = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiUrl = config.apiUrl ?? deriveApiUrl(this.baseUrl);
    this.contentRating = config.contentRating ?? ContentRating.MATURE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MangaKInterceptor("main", this.baseUrl);
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaKSettingsForm(this.sourceName);
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular",
        title: "Popular This Week",
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
      const genres = await this.genres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem",
          searchQuery: {
            title: "",
            filters: [],
            metadata: {
              searchMeta: { includedGenres: [genre.id] },
            },
          },
          name: genre.title,
          metadata: undefined,
        })),
        metadata: undefined,
      };
    }

    const meta = metadata as MangaKMetadata | undefined;
    const page = meta?.page ?? 1;

    const params: string[] = [];
    if (section.id === "popular") {
      params.push("sort=popular", "window=week");
    } else {
      params.push("sort=latest");
    }
    params.push(`page=${page}`, `limit=${PAGE_LIMIT}`);

    const blacklist = getBlacklist(this.sourceName);
    if (blacklist.length > 0) {
      params.push(`exclude=${encodeURIComponent(blacklist.join(","))}`);
    }

    const url = `${this.apiUrl}/titles/search?${params.join("&")}`;
    const dto = await this.fetchJson<SearchResponseDto>({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const item of dto.data?.items ?? []) {
      const parsed = this.itemToResult(item);
      if (!parsed || seen.has(parsed.mangaId)) continue;
      seen.add(parsed.mangaId);
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

    const hasNext = dto.data?.pagination?.has_next === true;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<MangaKSearchForm> {
    const meta = (query.metadata as { searchMeta?: MangaKSearchMeta })
      ?.searchMeta;
    return new MangaKSearchForm(await this.genres(), meta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaKMetadata | undefined;
    const page = meta?.page ?? 1;
    const search = (query.metadata as { searchMeta?: MangaKSearchMeta })
      ?.searchMeta;

    const params: string[] = [`page=${page}`, `limit=${PAGE_LIMIT}`];

    const titleQuery = (query.title || "").trim();
    if (titleQuery) {
      const filtered = titleQuery
        .replace(/[^A-Za-z0-9 ]/g, "")
        .trim()
        .slice(0, QUERY_LENGTH_LIMIT);
      if (filtered) params.push(`q=${encodeURIComponent(filtered)}`);
    }

    const single = (values: string[] | undefined): string | undefined => {
      const value = values?.[0];
      return value && value.length > 0 ? value : undefined;
    };

    const sort = single(search?.sort);
    if (sort) params.push(`sort=${encodeURIComponent(sort)}`);
    const contentRating = single(search?.contentRating);
    if (contentRating) {
      params.push(`content_rating=${encodeURIComponent(contentRating)}`);
    }
    const status = single(search?.status);
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    const type = single(search?.type);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    const demographic = single(search?.demographic);
    if (demographic) {
      params.push(`demographic=${encodeURIComponent(demographic)}`);
    }

    const author = (search?.author || "").trim();
    if (author) params.push(`author=${encodeURIComponent(author)}`);
    const minChapters = (search?.minChapters || "").trim();
    if (minChapters) params.push(`min_ch=${encodeURIComponent(minChapters)}`);

    const included = search?.includedGenres ?? [];
    if (included.length > 0) {
      params.push(`genres=${encodeURIComponent(included.join(","))}`);
    }

    // The blacklist always applies, but an explicitly included genre wins.
    const excluded = new Set<string>(search?.excludedGenres ?? []);
    for (const slug of getBlacklist(this.sourceName)) excluded.add(slug);
    for (const slug of included) excluded.delete(slug);
    if (excluded.size > 0) {
      params.push(`exclude=${encodeURIComponent([...excluded].join(","))}`);
    }

    const url = `${this.apiUrl}/titles/search?${params.join("&")}`;
    const dto = await this.fetchJson<SearchResponseDto>({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    for (const item of dto.data?.items ?? []) {
      const parsed = this.itemToResult(item);
      if (!parsed || seen.has(parsed.mangaId)) continue;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = dto.data?.pagination?.has_next === true;
    return {
      items: results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private itemToResult(
    item: SearchItemDto,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const url = (item.url || "").trim();
    const id = (item.id || "").trim();
    const title = (item.name || "").trim();
    if (!url || !id || !title) return undefined;
    // Encode the upstream SManga url: `<path>#<id>` so it round-trips.
    const mangaId = this.toSafeId(`${url}#${id}`);
    return {
      mangaId,
      imageUrl: this.absoluteUrl(item.cover || ""),
      title,
    };
  }

  // ----------------------------------------------------------------
  // Genres
  // ----------------------------------------------------------------

  // Genres are fetched from the API and cached in state so the settings form
  // can offer the blacklist options without performing a request itself.
  private async genres(): Promise<MangaKGenre[]> {
    try {
      const dto = await this.fetchJson<GenreListResponseDto>({
        url: `${this.apiUrl}/genres`,
        method: "GET",
      });
      const genres: MangaKGenre[] = [];
      for (const item of dto.data?.items ?? []) {
        const slug = (item.slug || "").trim();
        const name = (item.name || "").trim();
        if (!slug || !name) continue;
        genres.push({ id: slug, title: name });
      }
      if (genres.length > 0) {
        setCachedGenres(this.sourceName, genres);
        return genres;
      }
    } catch {
      // Fall through to the cached list when the request fails.
    }
    return getCachedGenres(this.sourceName);
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pageProps = this.extractPageProps($);
    const info = pageProps?.initialManga;
    if (!info) {
      throw new Error("Could not find manga details");
    }

    const genres = (info.genres ?? [])
      .map((g) => (g.name || "").trim())
      .filter((g) => g.length > 0);
    const authors = (info.authors ?? [])
      .map((a) => (a.name || "").trim())
      .filter((a) => a.length > 0);

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
        primaryTitle: (info.name || "").trim() || this.slugTitle(mangaId),
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(info.cover || ""),
        author: authors.length > 0 ? authors.join(", ") : undefined,
        synopsis: (info.summary || "").trim(),
        contentRating: this.contentRating,
        status: this.parseStatus(info.status || ""),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.mangaApiId(sourceManga.mangaId);
    if (!id) {
      throw new Error("Could not find manga ID");
    }

    const url = `${this.apiUrl}/titles/${encodeURIComponent(id)}/chapters?cv=${Date.now()}`;
    const dto = await this.fetchJson<ChapterListResponseDto>({
      url,
      method: "GET",
    });

    const raw = (dto.data?.chapters ?? []).filter(
      (c): c is ChapterItemDto => !!c && !!c.url,
    );
    // Upstream sorts by chapter_number descending (newest first).
    raw.sort((a, b) => (b.chapter_number ?? 0) - (a.chapter_number ?? 0));

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const c of raw) {
      const chapterId = this.parsePath(c.url || "");
      if (!chapterId || seen.has(chapterId)) continue;
      seen.add(chapterId);
      const name = (c.name || "").trim();
      chapters.push({
        chapterId,
        sourceManga,
        title: name || undefined,
        volume: 0,
        chapNum: c.chapter_number ?? this.parseChapterNumber(name),
        publishDate: this.parseDate(c.updated_at),
        langCode: this.langCode,
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pageProps = this.extractPageProps($);
    const images = pageProps?.initialChapter?.images;
    if (!images) {
      throw new Error("Could not find chapter images");
    }

    const pages = images
      .map((img) => this.absoluteUrl(img))
      .filter((img) => img.length > 0);

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
  // Next.js RSC extraction (port of keiyoushi extractNextJs)
  // ----------------------------------------------------------------

  // Walks the inline `self.__next_f.push` flight chunks, resolves RSC model
  // references, and returns the first object carrying a `pageProps` key
  // (the upstream predicate).
  private extractPageProps($: CheerioAPI): PageProps | undefined {
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
      const found = this.findPageProps(resolved);
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
      if (typeof value === "string" && value.startsWith("$")) {
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

  private findPageProps(element: unknown): PageProps | undefined {
    if (Array.isArray(element)) {
      for (const child of element) {
        const found = this.findPageProps(child);
        if (found) return found;
      }
      return undefined;
    }
    if (element && typeof element === "object") {
      const obj = element as Record<string, unknown>;
      if ("pageProps" in obj) {
        const pp = obj.pageProps;
        if (pp && typeof pp === "object") {
          return pp as PageProps;
        }
      }
      for (const child of Object.values(obj)) {
        const found = this.findPageProps(child);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ----------------------------------------------------------------
  // URL / id helpers
  // ----------------------------------------------------------------

  // The manga page URL is the part of the encoded id before the `#`.
  private mangaUrl(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const path = decoded.split("#")[0];
    if (path.startsWith("http")) return path;
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  // The API title id is the part of the encoded id after the `#`.
  private mangaApiId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const idx = decoded.lastIndexOf("#");
    return idx >= 0 ? decoded.substring(idx + 1).trim() : "";
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${this.baseUrl}/${slug.replace(/^\/+/, "")}`;
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
    const path = this.safeDecode(mangaId).split("#")[0];
    const slug = path.replace(/^.*\//, "").replace(/\/+$/, "");
    return slug.replace(/[-_]+/g, " ").trim() || slug;
  }

  private parseChapterNumber(name: string): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseDate(value: string | undefined): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${this.baseUrl}${s}` : `${this.baseUrl}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancelled")) return "Cancelled";
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

// Upstream derives the API host by prefixing the site host with `api.`.
function deriveApiUrl(baseUrl: string): string {
  const match = baseUrl.match(/^(https?:\/\/)([^/]+)/);
  if (!match) return baseUrl;
  return `${match[1]}api.${match[2]}`;
}
