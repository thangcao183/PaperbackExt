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

const DOMAIN = "reimanga.com";
const BASE_URL = `https://${DOMAIN}`;

interface ReiMangaMetadata {
  page?: number;
}

// ----------------------------------------------------------------
// Upstream JSON DTO shapes (from /api/manga endpoints)
// ----------------------------------------------------------------

interface ApiManga {
  id?: number;
  name_url?: string;
  title?: string;
  cover_url?: string | null;
}

interface ApiMangaList {
  data?: ApiManga[];
  initialData?: ApiManga[];
  pagination?: {
    currentPage?: number;
    totalPages?: number;
  };
}

interface ApiTag {
  name?: string;
  slug?: string;
}

interface ApiMangaDetails {
  id?: number;
  name_url?: string;
  title?: string;
  cover_url?: string | null;
  description?: string | null;
  alt_title?: string | null;
  completed?: number;
  rating?: number;
  is_adult?: number;
  genres?: ApiTag[];
  tags?: ApiTag[];
  authors?: { name?: string }[];
}

interface ApiMangaPage {
  manga?: ApiMangaDetails;
}

class ReiMangaInterceptor extends PaperbackInterceptor {
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

type ReiMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ReiMangaExtension implements ReiMangaImplementation {
  requestManager = new ReiMangaInterceptor("main");
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
    // Upstream sets a `showAdultContent=true` cookie so adult titles are returned.
    this.cookieStorageInterceptor.setCookie({
      name: "showAdultContent",
      value: "true",
      domain: DOMAIN,
      path: "/",
    });
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "trending",
        title: "Trending",
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
    if (section.id === "trending") {
      const data = await this.fetchJson<ApiManga[]>(
        `${BASE_URL}/api/manga/trending?limit=100`,
      );
      const items: DiscoverSectionItem[] = [];
      const seen = new Set<string>();
      for (const manga of Array.isArray(data) ? data : []) {
        const parsed = this.mangaFromApi(manga);
        if (!parsed || seen.has(parsed.mangaId)) continue;
        seen.add(parsed.mangaId);
        items.push({
          type: "featuredCarouselItem",
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          metadata: undefined,
        });
      }
      return { items, metadata: undefined };
    }

    // latest
    const meta = metadata as ReiMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const url =
      `${BASE_URL}/api/manga?page=${page}&limit=24` +
      `&sort=latest&order=desc`;
    const data = await this.fetchJson<ApiMangaList>(url);
    const list = data.data ?? data.initialData ?? [];
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const manga of list) {
      const parsed = this.mangaFromApi(manga);
      if (!parsed || seen.has(parsed.mangaId)) continue;
      seen.add(parsed.mangaId);
      items.push({
        type: "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    }
    const hasNext = this.hasNextPage(data);
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

    // Support pasting a direct manga URL as the search query (UrlActivity parity).
    if (titleQuery.startsWith("https://")) {
      const slug = this.slugFromShareUrl(titleQuery);
      if (slug) {
        const manga = await this.getMangaDetails(slug);
        return {
          items: [
            {
              mangaId: manga.mangaId,
              imageUrl: manga.mangaInfo.thumbnailUrl,
              title: manga.mangaInfo.primaryTitle,
              subtitle: undefined,
              metadata: undefined,
            },
          ],
          metadata: undefined,
        };
      }
    }

    const meta = metadata as ReiMangaMetadata | undefined;
    const page = meta?.page ?? 1;

    const params: string[] = [];
    params.push(`page=${page}`);
    params.push(`limit=24`);
    if (titleQuery) params.push(`search=${encodeURIComponent(titleQuery)}`);

    const genre = (query.metadata as { genre?: string } | undefined)?.genre;
    if (genre) params.push(`genre=${encodeURIComponent(genre)}`);

    const url = `${BASE_URL}/api/manga?${params.join("&")}`;
    const data = await this.fetchJson<ApiMangaList>(url);
    const list = data.data ?? data.initialData ?? [];

    const results: SearchResultItem[] = [];
    for (const manga of list) {
      const parsed = this.mangaFromApi(manga);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNext = this.hasNextPage(data);
    return {
      items: results,
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const numericId = slug.substring(slug.lastIndexOf("-") + 1);
    const data = await this.fetchJson<ApiMangaPage>(
      `${BASE_URL}/api/manga/${numericId}`,
    );
    const details = data.manga ?? {};

    const title = details.title || slug;
    const thumbnailUrl =
      details.cover_url ||
      `https://${DOMAIN}/covers/${details.id ?? numericId}/thumbnail.png`;

    const synopsisParts: string[] = [];
    const rating = details.rating ?? -1;
    if (rating > 0) {
      const filled = Math.min(5, Math.max(0, Math.round(rating / 2)));
      synopsisParts.push(`${"★".repeat(filled)}${"☆".repeat(5 - filled)} ${rating}`);
    }
    if (details.description && details.description.trim()) {
      synopsisParts.push(details.description.trim());
    }
    if (details.alt_title && details.alt_title.trim()) {
      const alts = details.alt_title
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((t) => `- ${t}`);
      if (alts.length > 0) {
        synopsisParts.push(`Alternative Titles:\n${alts.join("\n")}`);
      }
    }
    const synopsis = synopsisParts.join("\n\n");

    const author = (details.authors ?? [])
      .map((a) => (a.name ?? "").trim().replace(/,$/, "").trim())
      .filter((a) => a.length > 0)
      .join(", ");

    const tagGroups: TagSection[] = [];
    const genreTags = (details.genres ?? [])
      .map((t) => ({ name: (t.name ?? "").trim(), slug: t.slug ?? "" }))
      .filter((t) => t.name.length > 0);
    const otherTags = (details.tags ?? [])
      .map((t) => ({ name: (t.name ?? "").trim(), slug: t.slug ?? "" }))
      .filter((t) => t.name.length > 0);
    if (details.is_adult === 1) {
      genreTags.unshift({ name: "Adult", slug: "adult" });
    }
    if (genreTags.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreTags.map((t) => ({
          id: t.slug || t.name.toLowerCase().replace(/\s+/g, "-"),
          title: t.name,
        })),
      });
    }
    if (otherTags.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: otherTags.map((t) => ({
          id: t.slug || t.name.toLowerCase().replace(/\s+/g, "-"),
          title: t.name,
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
        artist: author || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: details.completed === 1 ? "Completed" : "Ongoing",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters (Next.js RSC flight payload via rsc:1 header)
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const body = await this.fetchRsc(url);

    const node = this.findInRsc(
      body,
      (obj) =>
        Array.isArray(obj.chapters) &&
        isObject(obj.manga) &&
        typeof (obj.manga as Record<string, unknown>).id !== "undefined",
    );

    const chapters: Chapter[] = [];
    if (!node) return chapters;

    const mangaNode = node.manga as Record<string, unknown>;
    const slug = String(mangaNode.name_url ?? "");
    const mangaNumericId = String(mangaNode.id ?? "");
    const rawChapters = node.chapters as Record<string, unknown>[];

    const seen = new Set<string>();
    rawChapters.forEach((chapter, index) => {
      const chapterNumericId = String(chapter.id ?? "");
      if (!chapterNumericId) return;
      const chapterId = this.toSafeId(
        `${slug}-${mangaNumericId}/${chapterNumericId}`,
      );
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = String(chapter.name ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const dateStr =
        (chapter.gdrive_upload_date as string | undefined) ??
        (chapter.updated_at as string | undefined) ??
        (chapter.created_at as string | undefined);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name, rawChapters.length - index),
        publishDate: this.parseDate(dateStr),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const body = await this.fetchRsc(url);

    const node = this.findInRsc(body, (obj) => Array.isArray(obj.images));

    const pages: string[] = [];
    if (node) {
      for (const image of node.images as Record<string, unknown>[]) {
        const src = String(image.image_url ?? "");
        if (src) pages.push(this.absoluteUrl(src));
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

  private mangaFromApi(
    manga: ApiManga,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const slug = manga.name_url;
    const id = manga.id;
    if (!slug || typeof id === "undefined") return undefined;
    const mangaId = this.toSafeId(`${slug}-${id}`);
    const imageUrl =
      manga.cover_url || `https://${DOMAIN}/covers/${id}/thumbnail.png`;
    const title = (manga.title ?? "").trim() || slug;
    return { mangaId, imageUrl, title };
  }

  private hasNextPage(data: ApiMangaList): boolean {
    const p = data.pagination;
    if (!p) return false;
    const current = p.currentPage ?? 0;
    const total = p.totalPages ?? 0;
    return current < total;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
  }

  private slugFromShareUrl(raw: string): string | undefined {
    try {
      const url = new URL(raw);
      if (url.hostname !== DOMAIN && url.hostname !== `www.${DOMAIN}`) {
        return undefined;
      }
      const segments = url.pathname.split("/").filter((s) => s.length > 0);
      if (segments[0] !== "manga" || !segments[1]) return undefined;
      return this.toSafeId(segments[1]);
    } catch {
      return undefined;
    }
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

  private parseChapterNumber(name: string, fallback: number): number {
    const m = (name ?? "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  private parseDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date(0);
    const t = Date.parse(dateStr);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  // ----------------------------------------------------------------
  // Fetch helpers
  // ----------------------------------------------------------------

  private async fetchJson<T>(url: string): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const text = Application.arrayBufferToUTF8String(data);
    return JSON.parse(text) as T;
  }

  // Requests the Next.js RSC flight payload (text/x-component) for a page.
  private async fetchRsc(url: string): Promise<string> {
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
  // Minimal Next.js RSC flight payload parser.
  //
  // The flight body is a sequence of `<hexid>:<content>` chunks. Two chunk
  // kinds carry data we care about:
  //   - `T<hexLen>,<text>`  binary/text chunk (length-prefixed in UTF-8 bytes)
  //   - `<json>`            an outlined JSON model row
  // We extract every JSON value we can parse and then recursively search for
  // the first object matching the caller's predicate.
  // ----------------------------------------------------------------

  private findInRsc(
    body: string,
    predicate: (obj: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    const payloads = this.extractRscPayloads(body);
    for (const payload of payloads) {
      const found = this.searchValue(payload, predicate);
      if (found) return found;
    }
    return undefined;
  }

  private extractRscPayloads(body: string): unknown[] {
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
        // Binary/text chunk: T<hexLen>,<content>
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
            // High surrogate -> supplementary char occupies 4 UTF-8 bytes.
            bytes += 4;
            pos++; // consume the high surrogate; loop increment handles the low
          } else {
            bytes += 3;
          }
          pos++;
        }

        const chunk = body.substring(start, pos);
        const parsed = this.tryParseJson(chunk);
        if (parsed !== undefined) results.push(parsed);
      } else {
        // JSON chunk parsed by bracket depth.
        const [element, end] = this.parseJsonAt(body, pos);
        if (element !== undefined) results.push(element);
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
          return [this.tryParseJson(body.substring(start, i)), i];
        }
      } else if (depth === 0 && /\s/.test(c)) {
        return [this.tryParseJson(body.substring(start, i - 1)), i];
      }
    }
    return [undefined, i];
  }

  private tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private searchValue(
    value: unknown,
    predicate: (obj: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = this.searchValue(child, predicate);
        if (found) return found;
      }
      return undefined;
    }
    if (isObject(value)) {
      if (predicate(value)) return value;
      for (const key of Object.keys(value)) {
        const found = this.searchValue(value[key], predicate);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ----------------------------------------------------------------
  // Cloudflare + cookies
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const ReiManga = new ReiMangaExtension();
