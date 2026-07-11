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

// ----------------------------------------------------------------
// Next.js RSC (React Flight) payload parsing
//
// templetoons.com is a Next.js App Router site. Requesting a route with the
// `rsc: 1` header yields a raw `text/x-component` flight stream instead of
// HTML. We port the keiyoushi `extractNextJs`/`extractNextJsRsc` helper: the
// stream is a sequence of `<hexId>:<chunk>` rows where a chunk is either
//   - `T<hexLen>,<content>`  (a binary text chunk, cached for `$<id>` refs), or
//   - a JSON value           (an outlined model row, cached for `$Q`/`$W`/`$id`)
// After collecting rows we resolve the `$`-reference markers and search the
// resulting trees for the first value matching a target shape. (Same parser
// used by our JNovel port.)
// ----------------------------------------------------------------

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function isObj(v: JsonValue): v is { [key: string]: JsonValue } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

interface RscPayloads {
  payloads: JsonValue[];
  chunkCache: Map<string, string>;
  modelCache: Map<string, JsonValue>;
}

function isHexId(id: string): boolean {
  if (id.length === 0) return false;
  for (const c of id) {
    if (!/[0-9a-fA-F]/.test(c)) return false;
  }
  return true;
}

function parseJsonAt(body: string, start: number): [JsonValue | null, number] {
  if (start >= body.length) return [null, start];

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
          return [JSON.parse(body.substring(start, i)) as JsonValue, i];
        } catch {
          return [null, i];
        }
      }
    }
    if (depth === 0 && /\s/.test(c)) {
      try {
        return [JSON.parse(body.substring(start, i - 1)) as JsonValue, i];
      } catch {
        return [null, i];
      }
    }
  }
  return [null, i];
}

function utf8ByteLen(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return 3;
}

function extractRscPayloads(body: string): RscPayloads {
  const payloads: JsonValue[] = [];
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, JsonValue>();
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
      // Binary chunk: T<hexLen>,<content> where hexLen is UTF-8 byte length.
      pos++;
      const commaIdx = body.indexOf(",", pos);
      if (commaIdx === -1) break;
      const byteLen = parseInt(body.substring(pos, commaIdx), 16);
      if (Number.isNaN(byteLen)) break;
      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;
      while (pos < body.length && bytes < byteLen) {
        const c = body[pos];
        const code = c.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff) {
          // high surrogate -> supplementary character is 4 UTF-8 bytes
          bytes += 4;
          pos++; // consume the high surrogate; loop increment handles the low
        } else {
          bytes += utf8ByteLen(c);
        }
        pos++;
      }
      const chunkContent = body.substring(start, pos);
      chunkCache.set(id, chunkContent);
      try {
        payloads.push(JSON.parse(chunkContent) as JsonValue);
      } catch {
        // not JSON, only useful as a string chunk reference
      }
    } else {
      const [element, end] = parseJsonAt(body, pos);
      if (element !== null) {
        payloads.push(element);
        modelCache.set(id, element);
      }
      pos = end;
    }
  }

  return { payloads, chunkCache, modelCache };
}

function resolveRefs(
  element: JsonValue,
  chunkCache: Map<string, string>,
  modelCache: Map<string, JsonValue>,
  resolving: Set<string> = new Set(),
): JsonValue {
  if (Array.isArray(element)) {
    return element.map((e) => resolveRefs(e, chunkCache, modelCache, resolving));
  }
  if (element !== null && typeof element === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(element)) {
      out[key] = resolveRefs(element[key], chunkCache, modelCache, resolving);
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
    const marker = str[1];
    if (marker === "$") return str.substring(1); // escaped '$'
    if (marker === "D") return str.substring(2); // Date ISO string
    if (marker === "n") return str.substring(2); // BigInt digit string
    if (marker === "Q") {
      return (
        resolveMapRef(str.substring(2), chunkCache, modelCache, resolving) ??
        element
      );
    }
    if (marker === "W") {
      return (
        resolveSetRef(str.substring(2), chunkCache, modelCache, resolving) ??
        element
      );
    }
    return (
      resolveModelRef(str.substring(1), chunkCache, modelCache, resolving) ??
      element
    );
  }
  return element;
}

function walkRefSegment(value: JsonValue, segment: string): JsonValue | null {
  if (Array.isArray(value)) {
    if (value.length >= 4 && value[0] === "$") {
      if (segment === "type") return value[1];
      if (segment === "key") return value[2];
      if (segment === "props") return value[3];
    }
    const idx = Number.parseInt(segment, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < value.length) return value[idx];
    return null;
  }
  if (value !== null && typeof value === "object") {
    return segment in value ? value[segment] : null;
  }
  return null;
}

function resolveModelRef(
  reference: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue | null {
  const segments = reference.split(":");
  const id = segments[0];
  if (segments.length === 1) {
    const chunk = chunkCache.get(id);
    if (chunk !== undefined) return chunk;
  }
  if (resolving.has(id)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  let value = modelCache.get(id);
  if (value === undefined) return null;
  for (let i = 1; i < segments.length; i++) {
    if (typeof value === "string" && value.startsWith("$")) {
      value = resolveRefs(value, chunkCache, modelCache, guard);
    }
    const next = walkRefSegment(value, segments[i]);
    if (next === null) return null;
    value = next;
  }
  return resolveRefs(value, chunkCache, modelCache, guard);
}

function resolveMapRef(
  id: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue | null {
  if (resolving.has(id)) return null;
  const entries = modelCache.get(id);
  if (!Array.isArray(entries)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  const resolved = resolveRefs(entries, chunkCache, modelCache, guard);
  if (!Array.isArray(resolved)) return null;
  const out: { [key: string]: JsonValue } = {};
  for (const pair of resolved) {
    if (Array.isArray(pair) && pair.length === 2) {
      const key = typeof pair[0] === "string" ? pair[0] : String(pair[0]);
      out[key] = pair[1];
    }
  }
  return out;
}

function resolveSetRef(
  id: string,
  chunkCache: Map<string, string>,
  modelCache: Map<string, JsonValue>,
  resolving: Set<string>,
): JsonValue | null {
  if (resolving.has(id)) return null;
  const values = modelCache.get(id);
  if (!Array.isArray(values)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  return resolveRefs(values, chunkCache, modelCache, guard);
}

// Depth-first search for the first value (object OR array) matching `predicate`.
function findFirst(
  element: JsonValue,
  predicate: (e: JsonValue) => boolean,
): JsonValue | null {
  if (predicate(element)) return element;
  if (Array.isArray(element)) {
    for (const child of element) {
      const r = findFirst(child, predicate);
      if (r !== null) return r;
    }
    return null;
  }
  if (element !== null && typeof element === "object") {
    for (const key of Object.keys(element)) {
      const r = findFirst(element[key], predicate);
      if (r !== null) return r;
    }
  }
  return null;
}

function extractNextJs(
  body: string,
  predicate: (e: JsonValue) => boolean,
): JsonValue | null {
  const { payloads, chunkCache, modelCache } = extractRscPayloads(body);
  for (const payload of payloads) {
    const resolved = resolveRefs(payload, chunkCache, modelCache);
    const result = findFirst(resolved, predicate);
    if (result !== null) return result;
  }
  return null;
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
    const body = await this.fetchRsc(`${BASE_URL}/comics`);
    // The browse list is the first array whose elements carry a series_slug.
    const found = extractNextJs(
      body,
      (e) =>
        Array.isArray(e) &&
        e.length > 0 &&
        isObj(e[0]) &&
        "series_slug" in e[0] &&
        "title" in e[0],
    );
    this.seriesCache = Array.isArray(found)
      ? (found.filter((s) => isObj(s)) as unknown as BrowseSeries[])
      : [];
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const body = await this.fetchRsc(url);
    // The details object carries a series_slug plus at least one detail-only
    // field (description / tag_series / adult), which distinguishes it from a
    // browse-list entry.
    const found = extractNextJs(
      body,
      (e) =>
        isObj(e) &&
        "series_slug" in e &&
        "title" in e &&
        ("description" in e || "tag_series" in e || "adult" in e),
    );
    const details: { [key: string]: JsonValue } = isObj(found) ? found : {};

    const title =
      typeof details.title === "string" && details.title.length > 0
        ? details.title
        : this.safeDecode(mangaId);
    const alternativeNames =
      typeof details.alternative_names === "string"
        ? details.alternative_names
        : "";
    const thumbnail =
      typeof details.thumbnail === "string" ? details.thumbnail : "";
    const author =
      typeof details.author === "string" ? details.author : undefined;
    const studio =
      typeof details.studio === "string" ? details.studio : undefined;
    const status =
      typeof details.status === "string" ? details.status : "";
    const rawDescription =
      typeof details.description === "string" ? details.description : "";

    // Sites sometimes append "#tag" hashtags at the end of the description,
    // preceded by a label word ("Tags:", "Keywords:", ...). Strip from the
    // first '#' and drop that trailing label word.
    const cleanDescription = rawDescription.includes("#")
      ? rawDescription.replace(/#.*$/s, "").replace(/[\w\s]+:?\s*$/, "").trim()
      : rawDescription;

    const synopsisParts: string[] = [];
    const strippedDescription = this.stripHtml(cleanDescription);
    if (strippedDescription) synopsisParts.push(strippedDescription);
    if (alternativeNames.trim()) {
      synopsisParts.push(`Alternative Name: ${alternativeNames}`);
    }

    const tags: string[] = [];
    if (typeof details.badge === "string" && details.badge) {
      tags.push(details.badge);
    }
    if (typeof details.release_year === "string" && details.release_year) {
      tags.push(details.release_year);
    }
    if (details.adult === true) tags.push("Adult");
    // tag_series: [{ tag: { name } }]
    if (Array.isArray(details.tag_series)) {
      for (const wrapper of details.tag_series) {
        if (isObj(wrapper) && isObj(wrapper.tag)) {
          const name = wrapper.tag.name;
          if (typeof name === "string" && name) tags.push(name);
        }
      }
    }
    // #hashtags embedded in the description also count as genres.
    if (rawDescription.includes("#")) {
      for (const m of rawDescription.matchAll(/#(\w+)/gi)) {
        tags.push(m[1]);
      }
    }

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
        primaryTitle: title,
        secondaryTitles: alternativeNames ? [alternativeNames] : [],
        thumbnailUrl: this.absoluteUrl(thumbnail),
        author,
        artist: studio,
        synopsis: synopsisParts.join("\n\n"),
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(status),
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
    const body = await this.fetchRsc(url);
    // The chapter list is the object carrying a "Season" array.
    const found = extractNextJs(
      body,
      (e) => isObj(e) && Array.isArray(e.Season),
    );
    if (!isObj(found) || !Array.isArray(found.Season)) return [];

    const mangaSlug = this.safeDecode(sourceManga.mangaId)
      .replace(/\/+$/, "")
      .split("/")
      .pop();

    const chapters: Chapter[] = [];
    for (const season of found.Season) {
      if (!isObj(season) || !Array.isArray(season.Chapter)) continue;
      for (const chapter of season.Chapter) {
        if (!isObj(chapter)) continue;
        if (chapter.price !== 0) continue;
        const chapterName =
          typeof chapter.chapter_name === "string" ? chapter.chapter_name : "";
        const chapterTitle =
          typeof chapter.chapter_title === "string"
            ? chapter.chapter_title
            : "";
        const chapterSlug =
          typeof chapter.chapter_slug === "string" ? chapter.chapter_slug : "";
        if (!chapterSlug) continue;
        const name =
          chapterName +
          (chapterTitle.trim() ? `: ${chapterTitle}` : "");
        chapters.push({
          chapterId: this.parsePath(`/comic/${mangaSlug}/${chapterSlug}`),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: this.parseChapterNumber(chapterName),
          publishDate: this.parseDate(
            typeof chapter.created_at === "string" ? chapter.created_at : null,
          ),
          langCode: "🇬🇧",
        });
      }
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const body = await this.fetchRsc(url);
    // The pages payload is the object carrying a "pages" string array.
    const found = extractNextJs(
      body,
      (e) =>
        isObj(e) &&
        Array.isArray(e.pages) &&
        (e.pages.length === 0 || typeof e.pages[0] === "string"),
    );
    const images: string[] =
      isObj(found) && Array.isArray(found.pages)
        ? found.pages.filter((p): p is string => typeof p === "string")
        : [];

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

  // Strip HTML tags and decode a few common entities (upstream uses
  // Jsoup.clean(..., Safelist.none()) which yields plain text).
  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim();
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

  async fetchString(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return Application.arrayBufferToUTF8String(data);
  }

  // Fetch a Next.js route as a raw React Flight (RSC) stream. The `rsc: 1`
  // header tells the App Router to return the `text/x-component` payload
  // instead of rendered HTML.
  async fetchRsc(url: string): Promise<string> {
    return this.fetchString({
      url,
      method: "GET",
      headers: { rsc: "1" },
    });
  }
}

export const TempleScan = new TempleScanExtension();
