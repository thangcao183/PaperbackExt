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
  SortingOption,
  SourceManga,
  TagSection,
} from "@paperback/types";
import { removeWatermark } from "./watermark";

const BASE_URL = "https://doujin.io";
const LATEST_LIMIT = 20;

// Upstream `sortOptions` (Filters.kt). The API takes `sort` + `sort_dir`, so
// each Paperback sorting option encodes both halves.
const SORT_OPTIONS: { id: string; label: string; sort: string; dir: string }[] = [
  { id: "published_at:desc", label: "Date (newest)", sort: "published_at", dir: "desc" },
  { id: "published_at:asc", label: "Date (oldest)", sort: "published_at", dir: "asc" },
  { id: "hidden_title:asc", label: "Alphabetical (A-Z)", sort: "hidden_title", dir: "asc" },
  { id: "hidden_title:desc", label: "Alphabetical (Z-A)", sort: "hidden_title", dir: "desc" },
];

// Tag list ported verbatim from the upstream DoujinioHelper.kt
const TAGS: { id: number; name: string }[] = [
  { id: 22, name: "Aggressive Sex" },
  { id: 23, name: "Anal" },
  { id: 104, name: "BBM" },
  { id: 105, name: "BSS" },
  { id: 62, name: "Big Breasts" },
  { id: 26, name: "Blowjob" },
  { id: 27, name: "Bondage" },
  { id: 29, name: "Cheating" },
  { id: 32, name: "Creampie" },
  { id: 33, name: "Crossdressing" },
  { id: 34, name: "Cunnilingus" },
  { id: 35, name: "Dark Skin" },
  { id: 36, name: "Defloration" },
  { id: 38, name: "Demon Girl" },
  { id: 51, name: "Dickgirl" },
  { id: 112, name: "Doll Joints" },
  { id: 41, name: "Elf" },
  { id: 106, name: "Exhibitionism" },
  { id: 107, name: "Family" },
  { id: 44, name: "Femdom" },
  { id: 46, name: "Footjob" },
  { id: 49, name: "Full Color" },
  { id: 50, name: "Furry" },
  { id: 53, name: "Gender Bender" },
  { id: 54, name: "Group" },
  { id: 55, name: "Gyaru" },
  { id: 56, name: "Gym Uniform" },
  { id: 114, name: "Kemonomimi" },
  { id: 61, name: "Lactation" },
  { id: 9, name: "Maid Uniform" },
  { id: 65, name: "Mind Control" },
  { id: 108, name: "Mindbreak" },
  { id: 109, name: "Monster Girl" },
  { id: 69, name: "Muscle" },
  { id: 71, name: "Netorare" },
  { id: 73, name: "Ninja Outfit" },
  { id: 74, name: "Non-H" },
  { id: 75, name: "Nun Outfit" },
  { id: 76, name: "Nurse Outfit" },
  { id: 78, name: "Old Man" },
  { id: 82, name: "Pay To Play" },
  { id: 80, name: "Petite" },
  { id: 81, name: "Pregnant" },
  { id: 83, name: "Rimjob" },
  { id: 84, name: "School Uniform" },
  { id: 110, name: "Small Breasts" },
  { id: 63, name: "Solo Action" },
  { id: 90, name: "Swimsuit" },
  { id: 91, name: "Tanlines" },
  { id: 92, name: "Tentacles" },
  { id: 93, name: "Titjob" },
  { id: 94, name: "Toys" },
  { id: 95, name: "Urination" },
  { id: 99, name: "Yaoi" },
];

interface DoujinIoMetadata {
  page?: number;
}

// ---- Upstream JSON DTOs (DoujinioDto.kt) ----

interface ApiTag {
  id: number;
  name: string;
}

interface ApiManga {
  optimus_id: number;
  title: string;
  description: string;
  thumb: string;
  tags?: ApiTag[];
  creator_name?: string;
}

interface ApiChapter {
  optimus_id: number;
  manga_optimus_id: number;
  chapter_name: string;
  chapter_order: number;
  published_at: string;
}

interface ApiSearchResponse {
  data: ApiManga[];
  to: number | null;
  total: number;
}

interface ApiManifestPage {
  href: string;
  type: string;
}

interface ApiManifest {
  metadata: { identifier: string };
  readingOrder: ApiManifestPage[];
}

/** `/api/mangas/{manga}/{chapter}/chm` — the per-chapter watermark AES key. */
interface ApiMangaKeys {
  chmkeys: number[];
}

class DoujinIoJ18Interceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.5",
    };
    // Upstream `cleanHeaders`: the search/latest POST endpoints answer 419 when
    // Referer or Origin is present.
    if (request.method === "POST") {
      delete request.headers["referer"];
    } else {
      request.headers["origin"] = BASE_URL;
    }
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

    // Upstream #18164: page images hide a clean patch that must be composited
    // over the watermark. `getChapterDetails` appends the chapter's AES key to
    // each page URL as a `#chm=...` fragment (fragments are never transmitted
    // over HTTP, so this is invisible to the server — same approach as Mangago).
    const keyBytes = parseWatermarkKey(request.url);
    if (keyBytes && response.status >= 200 && response.status < 300) {
      try {
        return await removeWatermark(data, keyBytes);
      } catch {
        // Never throw from interceptResponse — show the watermarked page
        // rather than nothing.
        return data;
      }
    }

    return data;
  }
}

/**
 * Recover the `chmkeys` bytes that `getChapterDetails` appended to a page URL
 * as `#chm=<comma-separated bytes>`. Returns undefined when the page is not
 * watermark-protected (or the chapter's key endpoint was unavailable).
 */
function parseWatermarkKey(url: string): Uint8Array | undefined {
  const fragment = url.split("#")[1];
  if (!fragment) return undefined;
  const match = fragment.match(/(?:^|&)chm=([0-9,]+)/);
  if (!match) return undefined;
  const parts = match[1].split(",").filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const bytes = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    bytes[i] = parseInt(parts[i], 10) & 0xff;
  }
  return bytes;
}

type DoujinIoJ18Implementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class DoujinIoJ18Extension implements DoujinIoJ18Implementation {
  requestManager = new DoujinIoJ18Interceptor("main");
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
        title: "Newest",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "tags",
        title: "Tags",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "tags") {
      const items: DiscoverSectionItem[] = TAGS.map((tag) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { tagId: tag.id },
        },
        name: tag.name,
        metadata: { tagId: tag.id },
      }));
      return { items, metadata: undefined };
    }

    if (section.id === "popular") {
      const list = await this.fetchMangaList({
        url: `${BASE_URL}/api/mangas/popular`,
        method: "GET",
      });
      const items: DiscoverSectionItem[] = list.map((m) => ({
        type: "featuredCarouselItem",
        mangaId: this.toSafeId(String(m.optimus_id)),
        imageUrl: this.absoluteUrl(m.thumb),
        title: m.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    // latest (paged, POST)
    const meta = metadata as DoujinIoMetadata | undefined;
    const page = meta?.page ?? 1;
    const list = await this.fetchMangaList({
      url: `${BASE_URL}/api/mangas/newest`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        limit: LATEST_LIMIT,
        offset: (page - 1) * LATEST_LIMIT,
      }),
    });
    const items: DiscoverSectionItem[] = list.map((m) => ({
      type: "simpleCarouselItem",
      mangaId: this.toSafeId(String(m.optimus_id)),
      imageUrl: this.absoluteUrl(m.thumb),
      title: m.title,
      metadata: undefined,
    }));
    return {
      items,
      metadata: list.length >= LATEST_LIMIT ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map(({ id, label }) => ({ id, label }));
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as DoujinIoMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as { tagId?: number } | undefined;
    const tags: number[] = [];
    if (typeof queryMeta?.tagId === "number") {
      tags.push(queryMeta.tagId);
    }

    // Upstream #18164 added `sort` / `sort_dir` to the search payload.
    const chosen =
      SORT_OPTIONS.find((o) => o.id === sortingOption?.id) ?? SORT_OPTIONS[0];

    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/api/mangas/search`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keyword: titleQuery,
        page,
        tags,
        sort: chosen.sort,
        sort_dir: chosen.dir,
      }),
    });
    if (response.status === 404) {
      return { items: [], metadata: undefined };
    }
    const parsed = this.parseWrapped<ApiSearchResponse>(data);

    const items: SearchResultItem[] = (parsed?.data ?? []).map((m) => ({
      mangaId: this.toSafeId(String(m.optimus_id)),
      imageUrl: this.absoluteUrl(m.thumb),
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage =
      parsed?.to != null && parsed.to < (parsed.total ?? 0);

    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.safeDecode(mangaId);
    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/api/mangas/${id}`,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const manga = this.parseWrapped<ApiManga>(data);
    if (!manga) {
      throw new Error("Content not found");
    }

    const tagGroups: TagSection[] = [];
    const mangaTags = manga.tags ?? [];
    if (mangaTags.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: mangaTags.map((t) => ({
          id: String(t.id),
          title: t.name,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.title,
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(manga.thumb),
        artist: manga.creator_name,
        synopsis: manga.description,
        contentRating: ContentRating.MATURE,
        status: "Completed",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.safeDecode(sourceManga.mangaId);
    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/api/chapters?manga_id=${id}`,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const list = this.parseWrapped<ApiChapter[]>(data) ?? [];

    // Upstream reverses the API order so newest is first.
    const reversed = [...list].reverse();

    return reversed.map((c) => ({
      chapterId: this.toSafeId(
        `manga/${c.manga_optimus_id}/chapter/${c.optimus_id}`,
      ),
      sourceManga,
      // Upstream #18164 prefixes an invisible separator because a chapter name
      // identical to the manga title gets trimmed away to an empty label.
      title: `\u2063${c.chapter_name}`,
      volume: 0,
      chapNum: c.chapter_order + 1,
      publishDate: this.parseDate(c.published_at),
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = this.safeDecode(chapter.chapterId);
    // path = "manga/{mangaId}/chapter/{chapterId}"
    const segments = path.split("/");
    const mangaId = segments[1] ?? "";
    const chapterId = segments[segments.length - 1] ?? "";

    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/api/mangas/${mangaId}/${chapterId}/manifest`,
      method: "GET",
      headers: {
        referer: `${BASE_URL}/manga/${mangaId}/chapter/${chapterId}`,
      },
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }

    const contentType = (
      response.headers?.["content-type"] ||
      response.headers?.["Content-Type"] ||
      ""
    ).toLowerCase();
    if (contentType.includes("text/html")) {
      throw new Error(
        "You need to login first through the WebView to read the chapter.",
      );
    }

    // Upstream #18164: `/chm` returns the AES key used to decrypt the clean
    // patch embedded in each page image. It is best-effort — when it fails the
    // pages simply stay watermarked instead of failing to load.
    const fragment = await this.fetchWatermarkFragment(mangaId, chapterId);

    const manifest = this.parseJson<ApiManifest>(data);
    const pages: string[] = [];
    if (manifest) {
      for (const page of manifest.readingOrder ?? []) {
        if (page.type && page.type.startsWith("image")) {
          pages.push(this.absoluteUrl(page.href) + fragment);
        }
      }
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  /**
   * Fetch the chapter's watermark-removal key and encode it as a URL fragment
   * (`#chm=1,2,3,...`) for the response interceptor to pick up. Returns an
   * empty string when the key is unavailable.
   */
  private async fetchWatermarkFragment(
    mangaId: string,
    chapterId: string,
  ): Promise<string> {
    try {
      const [response, data] = await Application.scheduleRequest({
        url: `${BASE_URL}/api/mangas/${mangaId}/${chapterId}/chm`,
        method: "GET",
        headers: {
          referer: `${BASE_URL}/manga/${mangaId}/chapter/${chapterId}`,
        },
      });
      if (response.status < 200 || response.status >= 300) return "";
      const keys = this.parseJson<ApiMangaKeys>(data);
      const chmkeys = keys?.chmkeys;
      if (!chmkeys || chmkeys.length === 0) return "";
      return `#chm=${chmkeys.map((k) => k & 0xff).join(",")}`;
    } catch {
      return "";
    }
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private async fetchMangaList(request: Request): Promise<ApiManga[]> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      return [];
    }
    return this.parseWrapped<ApiManga[]>(data) ?? [];
  }

  // The API wraps payloads in { data: T } (PageResponse<T>).
  private parseWrapped<T>(data: ArrayBuffer): T | undefined {
    const parsed = this.parseJson<{ data?: T }>(data);
    return parsed?.data;
  }

  private parseJson<T>(data: ArrayBuffer): T | undefined {
    try {
      return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
    } catch {
      return undefined;
    }
  }

  private parseDate(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    // Upstream format: "yyyy-MM-dd HH:mm:ss"
    const iso = dateStr.trim().replace(" ", "T");
    const t = Date.parse(iso);
    if (!isNaN(t)) return new Date(t);
    const t2 = Date.parse(dateStr);
    return isNaN(t2) ? new Date(0) : new Date(t2);
  }

  private mangaUrl(mangaId: string): string {
    const id = this.safeDecode(mangaId);
    if (id.startsWith("http")) return id;
    return `${BASE_URL}/manga/${id.replace(/^\/+/, "")}`;
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

  // ----------------------------------------------------------------
  // Cloudflare
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

export const DoujinIoJ18 = new DoujinIoJ18Extension();
