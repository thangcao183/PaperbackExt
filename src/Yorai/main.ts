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

const BASE_URL = "https://yorai.io";
const API_URL = `${BASE_URL}/api`;

interface YoraiMetadata {
  page?: number;
}

// ----------------------------------------------------------------
// JSON value helpers (untyped tree walking)
// ----------------------------------------------------------------

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function isObject(v: unknown): v is { [key: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class YoraiInterceptor extends PaperbackInterceptor {
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

type YoraiImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class YoraiExtension implements YoraiImplementation {
  requestManager = new YoraiInterceptor("main");
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
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as YoraiMetadata | undefined;
    const page = meta?.page ?? 1;
    const url =
      section.id === "popular"
        ? `${API_URL}/comics/browse?page=${page}&sort=views`
        : `${API_URL}/comics/browse?page=${page}`;

    const browse = await this.fetchJson(url);
    const { comics, hasNextPage } = this.parseBrowse(browse);

    const items: DiscoverSectionItem[] = comics.map((c) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: c.mangaId,
      imageUrl: c.imageUrl,
      title: c.title,
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
    const meta = metadata as YoraiMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const params: string[] = [];
    params.push(`page=${page}`);
    params.push(`genres=`);
    params.push(`q=${encodeURIComponent(titleQuery)}`);
    const url = `${API_URL}/comics/browse?${params.join("&")}`;

    const browse = await this.fetchJson(url);
    const { comics, hasNextPage } = this.parseBrowse(browse);

    const results: SearchResultItem[] = comics.map((c) => ({
      mangaId: c.mangaId,
      imageUrl: c.imageUrl,
      title: c.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private parseBrowse(data: unknown): {
    comics: { mangaId: string; title: string; imageUrl: string }[];
    hasNextPage: boolean;
  } {
    if (!isObject(data)) return { comics: [], hasNextPage: false };
    const rawComics = Array.isArray(data.comics) ? data.comics : [];
    const page = typeof data.page === "number" ? data.page : 1;
    const totalPages =
      typeof data.totalPages === "number" ? data.totalPages : page;

    const comics = rawComics
      .map((entry) => {
        if (!isObject(entry)) return undefined;
        const slug = typeof entry.slug === "string" ? entry.slug : "";
        const title = typeof entry.title === "string" ? entry.title : "";
        const coverUrl =
          typeof entry.coverUrl === "string" ? entry.coverUrl : "";
        if (!slug) return undefined;
        return {
          mangaId: this.toSafeId(slug),
          title,
          imageUrl: this.absoluteUrl(coverUrl),
        };
      })
      .filter(
        (c): c is { mangaId: string; title: string; imageUrl: string } =>
          c !== undefined,
      );

    return { comics, hasNextPage: page < totalPages };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const body = await this.fetchRscText(url);
    const payloads = parseRscPayloads(body);

    // description: { name: "description", content: ... }
    const descNode = findFirst(
      payloads,
      (v) =>
        isObject(v) &&
        v.name === "description" &&
        typeof v.content === "string",
    );
    const synopsis =
      descNode && isObject(descNode) && typeof descNode.content === "string"
        ? descNode.content
        : "";

    // tags: list of { name, slug }
    const tagList = findFirst(
      payloads,
      (v) =>
        Array.isArray(v) &&
        v.length > 0 &&
        isObject(v[0]) &&
        typeof v[0].name === "string" &&
        typeof v[0].slug === "string",
    );
    const genres: string[] = [];
    if (Array.isArray(tagList)) {
      for (const t of tagList) {
        if (isObject(t) && typeof t.name === "string") genres.push(t.name);
      }
    }

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "_"),
          title: g,
        })),
      });
    }

    const status = body.includes("releasing") ? "Ongoing" : "Completed";

    // attempt to recover a title from the chapters payload, else the slug
    const slug = this.safeDecode(mangaId);
    const chaptersNode = findFirst(payloads, isChaptersNode);
    let title = slug;
    if (chaptersNode && isObject(chaptersNode)) {
      const t = chaptersNode["title"];
      if (typeof t === "string" && t.length > 0) title = t;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: "",
        synopsis,
        contentRating: ContentRating.EVERYONE,
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
    const body = await this.fetchRscText(url);
    const payloads = parseRscPayloads(body);

    const chaptersNode = findFirst(payloads, isChaptersNode);
    if (!chaptersNode || !isObject(chaptersNode)) return [];

    const slug =
      typeof chaptersNode.slug === "string"
        ? chaptersNode.slug
        : this.safeDecode(sourceManga.mangaId);
    const defaultSource =
      typeof chaptersNode.defaultSource === "string"
        ? chaptersNode.defaultSource
        : "";
    const rawChapters = Array.isArray(chaptersNode.chapters)
      ? chaptersNode.chapters
      : [];

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const entry of rawChapters) {
      if (!isObject(entry)) continue;
      const sourceName =
        typeof entry.source_name === "string" ? entry.source_name : "";
      if (defaultSource && sourceName !== defaultSource) continue;

      const number = typeof entry.number === "number" ? entry.number : 0;
      const rawTitle = typeof entry.title === "string" ? entry.title : "";
      const name =
        rawTitle.length > 0 ? rawTitle : `Chapter ${Math.trunc(number)}`;

      const chapterId = this.toSafeId(`${slug}|${number}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: number,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const body = await this.fetchRscText(url);
    const payloads = parseRscPayloads(body);

    const node = findFirst(
      payloads,
      (v) => isObject(v) && Array.isArray(v.imageUrls),
    );

    const pages: string[] = [];
    if (node && isObject(node) && Array.isArray(node.imageUrls)) {
      for (const u of node.imageUrls) {
        if (typeof u === "string" && u.length > 0) {
          pages.push(this.absoluteUrl(u));
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
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/comic/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const decoded = this.safeDecode(chapterId);
    if (decoded.startsWith("http")) return decoded;
    const [slug, number] = decoded.split("|");
    return `${BASE_URL}/comic/${slug}/chapter/${number}`;
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=&:|]/g, (c) => {
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

  // ----------------------------------------------------------------
  // Fetching
  // ----------------------------------------------------------------

  private async fetchJson(url: string): Promise<unknown> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const text = Application.arrayBufferToUTF8String(data);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private async fetchRscText(url: string): Promise<string> {
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
}

// ----------------------------------------------------------------
// Next.js RSC flight-data extraction (ported from keiyoushi NextJs.kt)
//
// The comic / chapter pages are served as React Server Component flight
// payloads (text/x-component) when requested with the `rsc: 1` header.
// We parse the chunked payload, build the chunk/model caches, resolve
// the `$`-prefixed reference markers, and then search the resolved tree
// for the JSON shapes we need.
// ----------------------------------------------------------------

interface RscParse {
  chunks: Map<string, string>;
  models: Map<string, JsonValue>;
  payloads: JsonValue[];
}

function parseRscPayloads(body: string): JsonValue[] {
  const parse = extractRscPayloads(body);
  const resolved: JsonValue[] = [];
  for (const payload of parse.payloads) {
    resolved.push(resolveRefs(payload, parse.chunks, parse.models, new Set()));
  }
  return resolved;
}

function isHexId(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) {
    const isDigit = c >= "0" && c <= "9";
    const isLower = c >= "a" && c <= "f";
    const isUpper = c >= "A" && c <= "F";
    if (!isDigit && !isLower && !isUpper) return false;
  }
  return true;
}

function extractRscPayloads(body: string): RscParse {
  const chunks = new Map<string, string>();
  const models = new Map<string, JsonValue>();
  const payloads: JsonValue[] = [];
  let pos = 0;

  while (pos < body.length) {
    const colonIdx = body.indexOf(":", pos);
    if (colonIdx === -1) break;

    const id = body.substring(pos, colonIdx);
    if (!isHexId(id)) {
      pos++;
      continue;
    }

    pos = colonIdx + 1;
    if (pos >= body.length) break;

    if (body[pos] === "T") {
      // Binary chunk: T<hexLen>,<content>
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
          // high surrogate -> supplementary char (4 UTF-8 bytes)
          bytes += 4;
          pos++; // consume the high surrogate; loop increment handles the low
        } else {
          bytes += 3;
        }
        pos++;
      }
      const chunkContent = body.substring(start, pos);
      chunks.set(id, chunkContent);
      const parsed = tryParseJson(chunkContent);
      if (parsed !== undefined) payloads.push(parsed);
    } else {
      const [element, end] = parseJsonAt(body, pos);
      if (element !== undefined) {
        payloads.push(element);
        models.set(id, element);
      }
      pos = end;
    }
  }

  return { chunks, models, payloads };
}

function tryParseJson(s: string): JsonValue | undefined {
  try {
    return JSON.parse(s) as JsonValue;
  } catch {
    return undefined;
  }
}

function parseJsonAt(
  body: string,
  start: number,
): [JsonValue | undefined, number] {
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
        return [tryParseJson(body.substring(start, i)), i];
      }
    }
    if (depth === 0 && /\s/.test(c)) {
      return [tryParseJson(body.substring(start, i - 1)), i];
    }
  }
  return [undefined, i];
}

function resolveRefs(
  element: JsonValue,
  chunks: Map<string, string>,
  models: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue {
  if (Array.isArray(element)) {
    return element.map((e) => resolveRefs(e, chunks, models, resolving));
  }
  if (isObject(element)) {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(element)) {
      out[key] = resolveRefs(element[key], chunks, models, resolving);
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
    if (second === "$") return str.substring(1); // escaped '$'
    if (second === "D") return str.substring(2); // Date ISO string
    if (second === "n") return str.substring(2); // BigInt digits
    if (second === "Q") {
      const r = resolveMapRef(str.substring(2), chunks, models, resolving);
      return r === undefined ? element : r;
    }
    if (second === "W") {
      const r = resolveSetRef(str.substring(2), chunks, models, resolving);
      return r === undefined ? element : r;
    }
    const r = resolveModelRef(str.substring(1), chunks, models, resolving);
    return r === undefined ? element : r;
  }
  return element;
}

function resolveModelRef(
  reference: string,
  chunks: Map<string, string>,
  models: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue | undefined {
  const segments = reference.split(":");
  const id = segments[0];
  if (segments.length === 1) {
    const chunk = chunks.get(id);
    if (chunk !== undefined) return chunk;
  }
  if (resolving.has(id)) return undefined;
  const guard = new Set(resolving);
  guard.add(id);
  let value = models.get(id);
  if (value === undefined) return undefined;
  for (let i = 1; i < segments.length; i++) {
    if (typeof value === "string" && value.startsWith("$")) {
      value = resolveRefs(value, chunks, models, guard);
    }
    const next = walkRefSegment(value, segments[i]);
    if (next === undefined) return undefined;
    value = next;
  }
  return resolveRefs(value, chunks, models, guard);
}

function walkRefSegment(
  value: JsonValue,
  segment: string,
): JsonValue | undefined {
  if (isObject(value)) {
    return value[segment];
  }
  if (Array.isArray(value)) {
    if (value.length >= 4 && value[0] === "$") {
      if (segment === "type") return value[1];
      if (segment === "key") return value[2];
      if (segment === "props") return value[3];
    }
    const idx = parseInt(segment, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < value.length) return value[idx];
    return undefined;
  }
  return undefined;
}

function resolveMapRef(
  id: string,
  chunks: Map<string, string>,
  models: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue | undefined {
  if (resolving.has(id)) return undefined;
  const entries = models.get(id);
  if (!Array.isArray(entries)) return undefined;
  const guard = new Set(resolving);
  guard.add(id);
  const resolved = resolveRefs(entries, chunks, models, guard);
  if (!Array.isArray(resolved)) return undefined;
  const out: { [key: string]: JsonValue } = {};
  for (const pair of resolved) {
    if (Array.isArray(pair) && pair.length === 2) {
      const k = pair[0];
      const key = typeof k === "string" ? k : String(k);
      out[key] = pair[1];
    }
  }
  return out;
}

function resolveSetRef(
  id: string,
  chunks: Map<string, string>,
  models: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue | undefined {
  if (resolving.has(id)) return undefined;
  const values = models.get(id);
  if (!Array.isArray(values)) return undefined;
  const guard = new Set(resolving);
  guard.add(id);
  return resolveRefs(values, chunks, models, guard);
}

function findFirst(
  payloads: JsonValue[],
  predicate: (v: JsonValue) => boolean,
): JsonValue | undefined {
  for (const payload of payloads) {
    const found = walkFind(payload, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function walkFind(
  value: JsonValue,
  predicate: (v: JsonValue) => boolean,
): JsonValue | undefined {
  if (!isObject(value) && !Array.isArray(value)) return undefined;
  if (predicate(value)) return value;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = walkFind(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isChaptersNode(v: JsonValue): boolean {
  return (
    isObject(v) &&
    typeof v.slug === "string" &&
    Array.isArray(v.chapters) &&
    typeof v.defaultSource === "string"
  );
}

export const Yorai = new YoraiExtension();
