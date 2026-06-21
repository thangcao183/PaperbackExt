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

const DOMAIN = "coolmic.me";
const BASE_URL = `https://${DOMAIN}`;
const API_URL = `${BASE_URL}/api/v1`;
const CDN_URL = `https://en-img.${DOMAIN}`;
const SEARCH_URL = `https://en-search.${DOMAIN}`;

const SEARCH_SIZE = 20;

// Sort values mirrored from the upstream Kotlin SortFilter.
const SORT_RELEVANCE = "_score+desc,+like_vote_count+desc";
const SORT_RECENT = "start_at+desc";
const SORT_POPULAR = "like_vote_count+desc";

interface CoolmicMetadata {
  page?: number;
  sort?: string;
}

// ----------------------------------------------------------------
// JSON DTO shapes (mirrored from upstream Dto.kt)
// ----------------------------------------------------------------

interface SeriesResponse {
  hits?: {
    found?: number;
    start?: number;
    hit?: { fields?: { title_id?: string; title_name?: string } }[];
  };
}

interface NamedEntity {
  name?: string;
}

interface DetailsResponse {
  title?: {
    name?: string;
    summary?: string | null;
    vertical_thumbnail_url?: string | null;
    artists?: NamedEntity[] | null;
    genres?: NamedEntity[] | null;
    sub_genres?: NamedEntity[] | null;
    tags?: NamedEntity[] | null;
    is_completed?: boolean | null;
    is_mature?: boolean | null;
    agency?: string | null;
  };
  episodes?: {
    id?: number;
    number?: string;
    start_at?: string | null;
    is_free?: boolean | null;
    was_purchased?: boolean | null;
    display_order?: number | null;
  }[];
}

interface ViewerResponse {
  image_data?: { num?: number; path?: string }[] | null;
}

// The per-page JSON returned when a page `path` is fetched. The actual JPEG
// is AES-CBC encrypted; the password for the PBKDF2-derived key is obtained
// from the /api/v1/decryption_keys endpoint (see resolvePageKey).
interface PageResponse {
  encrypted_image?: string;
  iv?: string;
  salt?: string;
  iterations?: number;
  kms_encrypted_data_key?: string;
  file_name?: string;
}

interface KeyResponse {
  decrypted_key?: string;
}

// Parsed contents of a page URL's #fragment, carrying the decryption
// password into interceptResponse.
function parseFragment(url: string): { key: string } | undefined {
  const fragment = url.split("#")[1] ?? "";
  if (!fragment.startsWith("key=")) return undefined;
  const key = fragment.slice("key=".length);
  if (!key) return undefined;
  return { key };
}

function isPageResponse(value: unknown): value is PageResponse {
  return typeof value === "object" && value !== null;
}

function isKeyResponse(value: unknown): value is KeyResponse {
  return typeof value === "object" && value !== null;
}

class CoolmicInterceptor extends PaperbackInterceptor {
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

    // Page images are delivered as an AES-CBC encrypted blob inside a JSON
    // envelope. The decryption password rides in the URL fragment, baked in
    // during getChapterDetails. Everything else passes through untouched.
    const parsed = parseFragment(request.url);
    if (parsed) {
      try {
        return await decryptPageImage(data, parsed.key);
      } catch {
        // On any failure return the original bytes so the reader still gets
        // *something* rather than an error.
        return data;
      }
    }

    return data;
  }
}

type CoolmicImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class CoolmicExtension implements CoolmicImplementation {
  requestManager = new CoolmicInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // CSRF token cached across key requests (mirrors upstream cachedCsrfToken).
  private cachedCsrfToken: string | undefined;

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
    // Upstream sets an "is_mature=true" cookie to unlock mature listings.
    this.cookieStorageInterceptor.setCookie({
      name: "is_mature",
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
        id: "popular",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as CoolmicMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? SORT_POPULAR : SORT_RECENT;

    const result = await this.fetchSeries({ page, sort });

    const items: DiscoverSectionItem[] = result.items.map((it) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: it.mangaId,
      imageUrl: it.imageUrl,
      title: it.title,
      metadata: undefined,
    }));

    return {
      items,
      metadata: result.hasNextPage ? { page: page + 1, sort } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as CoolmicMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const result = await this.fetchSeries({
      page,
      sort: SORT_RELEVANCE,
      query: titleQuery,
    });

    const items: SearchResultItem[] = result.items.map((it) => ({
      mangaId: it.mangaId,
      imageUrl: it.imageUrl,
      title: it.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items,
      metadata: result.hasNextPage
        ? { page: page + 1, sort: SORT_RELEVANCE }
        : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Series search helper (CloudSearch JSON API)
  // ----------------------------------------------------------------

  private async fetchSeries(opts: {
    page: number;
    sort: string;
    query?: string;
  }): Promise<{
    items: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  }> {
    const keywords = (opts.query || "")
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map((s) => `(${s}|${s}*)`)
      .join(" ");

    const params: string[] = [];
    params.push(`q=${encodeURIComponent(keywords || "(matchall)")}`);
    params.push(`size=${SEARCH_SIZE}`);
    params.push(`start=${(opts.page - 1) * SEARCH_SIZE}`);
    params.push(`q.options=`);
    params.push(`q.parser=${keywords ? "simple" : "structured"}`);
    params.push(`return=_all_fields`);
    // sort is pre-encoded with '+' separators upstream, keep verbatim.
    params.push(`sort=${opts.sort}`);
    params.push(`fq=`);

    const url = `${SEARCH_URL}/search?${params.join("&")}`;
    const json = await this.fetchJson<SeriesResponse>({ url, method: "GET" });

    const hits = json.hits;
    const start = hits?.start ?? 0;
    const found = hits?.found ?? 0;
    const hasNextPage = start + SEARCH_SIZE < found;

    const items: { mangaId: string; imageUrl: string; title: string }[] = [];
    for (const hit of hits?.hit ?? []) {
      const titleId = hit.fields?.title_id;
      const titleName = hit.fields?.title_name;
      if (!titleId || !titleName) continue;
      items.push({
        mangaId: this.toSafeId(titleId),
        imageUrl: this.thumbnailFor(titleId),
        title: titleName,
      });
    }

    return { items, hasNextPage };
  }

  private thumbnailFor(titleId: string): string {
    const id = titleId.padStart(9, "0");
    return `${CDN_URL}/titles/${id.slice(0, 3)}/${id.slice(0, 6)}/${id}/${id}_large_vertical.jpg`;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const details = await this.fetchPageObjects(mangaId);
    const title = details.title ?? {};

    const artist = (title.artists ?? [])
      .map((a) => a.name)
      .filter((n): n is string => !!n)
      .join(", ");

    let synopsis = title.summary ?? "";
    if (title.agency) synopsis += `\n\nPublisher: ${title.agency}`;
    if (title.is_mature === true) synopsis += "\n\nRating: 18+";

    const genreNames = Array.from(
      new Set(
        [
          ...(title.genres ?? []),
          ...(title.sub_genres ?? []),
          ...(title.tags ?? []),
        ]
          .map((g) => g.name)
          .filter((n): n is string => !!n),
      ),
    );

    const tagGroups: TagSection[] = [];
    if (genreNames.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreNames.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    let thumbnailUrl = title.vertical_thumbnail_url ?? "";
    if (thumbnailUrl) {
      thumbnailUrl = thumbnailUrl.replace(
        "_vertical.jpg",
        "_large_vertical.jpg",
      );
    } else {
      thumbnailUrl = this.thumbnailFor(this.safeDecode(mangaId));
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title.name ?? this.safeDecode(mangaId),
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(thumbnailUrl),
        artist: artist || undefined,
        synopsis: synopsis.trim(),
        contentRating: ContentRating.MATURE,
        status: title.is_completed === true ? "Completed" : "Ongoing",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const details = await this.fetchPageObjects(sourceManga.mangaId);
    const episodes = details.episodes ?? [];

    const chapters: Chapter[] = [];
    for (const ep of episodes) {
      if (ep.id == null) continue;
      const isLocked = ep.is_free === false && ep.was_purchased === false;
      const lock = isLocked ? "🔒 " : "";
      const number = ep.number ?? "";
      chapters.push({
        chapterId: this.toSafeId(String(ep.id)),
        sourceManga,
        title: `${lock}Chapter ${number}`.trim(),
        volume: 0,
        chapNum: ep.display_order ?? -1,
        publishDate: this.parseDate(ep.start_at),
        langCode: "🇬🇧",
      });
    }

    // Upstream reverses the episode list to present newest first.
    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${API_URL}/viewer/comic/secure_episodes/${this.safeDecode(chapter.chapterId)}`;
    const json = await this.fetchJson<ViewerResponse>({ url, method: "GET" });

    if (!json.image_data || json.image_data.length === 0) {
      throw new Error("Log in via WebView and purchase this chapter to read.");
    }

    const sorted = [...json.image_data].sort(
      (a, b) => (a.num ?? 0) - (b.num ?? 0),
    );

    // For each page, fetch the page JSON to obtain its KMS-encrypted data key
    // and file name, ask /api/v1/decryption_keys to decrypt the key, then bake
    // the resulting password into the page URL fragment. interceptResponse will
    // re-fetch the same JSON and use this password to AES-CBC decrypt the JPEG.
    const pages: string[] = [];
    for (const img of sorted) {
      if (!img.path) continue;
      const pageUrl = this.absoluteUrl(img.path);
      const key = await this.resolvePageKey(pageUrl);
      pages.push(key ? `${pageUrl}#key=${key}` : pageUrl);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // Fetch the page envelope, then resolve its decryption password via the
  // decryption_keys endpoint (retrying once with a refreshed CSRF token).
  private async resolvePageKey(pageUrl: string): Promise<string | undefined> {
    let pageJson: PageResponse;
    try {
      pageJson = await this.fetchJson<PageResponse>({
        url: pageUrl,
        method: "GET",
      });
    } catch {
      return undefined;
    }

    const encryptedKey = pageJson.kms_encrypted_data_key;
    const fileName = pageJson.file_name;
    if (!encryptedKey || !fileName) return undefined;

    let key = await this.requestKey(encryptedKey, fileName, false);
    if (!key) key = await this.requestKey(encryptedKey, fileName, true);
    return key;
  }

  private async requestKey(
    encryptedKey: string,
    fileName: string,
    refresh: boolean,
  ): Promise<string | undefined> {
    const token = await this.csrfToken(refresh);
    if (!token) return undefined;

    try {
      const [response, data] = await Application.scheduleRequest({
        url: `${API_URL}/decryption_keys`,
        method: "POST",
        headers: {
          origin: BASE_URL,
          "content-type": "application/json",
          "x-csrf-token": token,
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify({
          encrypted_key: encryptedKey,
          file_name: fileName,
        }),
      });
      if (response.status < 200 || response.status >= 300) return undefined;
      const parsed: unknown = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      );
      if (isKeyResponse(parsed) && parsed.decrypted_key) {
        return parsed.decrypted_key;
      }
    } catch {
      // fall through
    }
    return undefined;
  }

  // Read (and cache) the page CSRF token from the home page meta tag.
  private async csrfToken(refresh: boolean): Promise<string | undefined> {
    if (refresh) this.cachedCsrfToken = undefined;
    if (this.cachedCsrfToken) return this.cachedCsrfToken;

    try {
      const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
      const token = $("meta[name=csrf-token]").first().attr("content");
      if (token) this.cachedCsrfToken = token;
      return token;
    } catch {
      return undefined;
    }
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Details page JSON extraction
  // ----------------------------------------------------------------

  // The details page embeds the series + episode JSON in a custom
  // <title-page :page-objects="..."> attribute (mirrors upstream).
  private async fetchPageObjects(mangaId: string): Promise<DetailsResponse> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const raw = $("title-page").first().attr(":page-objects");
    if (!raw) {
      throw new Error("Could not parse details page");
    }
    return JSON.parse(raw) as DetailsResponse;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/titles/${slug.replace(/^\/+/, "")}`;
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

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    // Upstream parses MM/dd/yy.
    const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const month = parseInt(m[1], 10) - 1;
      const day = parseInt(m[2], 10);
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str) as T;
  }
}

// --------------------------------------------------------------------
// Page image decryption (module-level helpers)
//
// The page URL serves a JSON envelope, not a JPEG. The envelope contains the
// AES-CBC-encrypted JPEG plus the PBKDF2 parameters (salt, iterations, iv). The
// password is fetched in getChapterDetails and carried in via the fragment.
// Decryption runs inside a webview so we can use window.crypto.subtle for both
// PBKDF2WithHmacSHA256 key derivation and AES-CBC/PKCS7 decryption.
// --------------------------------------------------------------------

async function decryptPageImage(
  data: ArrayBuffer,
  password: string,
): Promise<ArrayBuffer> {
  const jsonStr = Application.arrayBufferToUTF8String(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Not a JSON envelope (e.g. already-decrypted bytes) — pass through.
    return data;
  }
  if (!isPageResponse(parsed)) return data;

  const encryptedImage = parsed.encrypted_image;
  const iv = parsed.iv;
  const salt = parsed.salt;
  const iterations = parsed.iterations;
  if (!encryptedImage || !iv || !salt || !iterations) return data;

  const inject = `
(function(){
  return new Promise(function(resolve){
    try {
      var subtle = window.crypto.subtle;
      function b64ToBytes(b64){
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      function bytesToB64(bytes){
        var bin = "";
        var arr = new Uint8Array(bytes);
        for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
        return btoa(bin);
      }
      var password = ${JSON.stringify(password)};
      var salt = b64ToBytes(${JSON.stringify(salt)});
      var iv = b64ToBytes(${JSON.stringify(iv)});
      var cipher = b64ToBytes(${JSON.stringify(encryptedImage)});
      var iterations = ${JSON.stringify(iterations)};
      var enc = new TextEncoder();
      subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"])
        .then(function(baseKey){
          return subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
            baseKey,
            { name: "AES-CBC", length: 256 },
            false,
            ["decrypt"]
          );
        })
        .then(function(aesKey){
          return subtle.decrypt({ name: "AES-CBC", iv: iv }, aesKey, cipher);
        })
        .then(function(plain){
          resolve(bytesToB64(plain));
        })
        .catch(function(){ resolve(""); });
    } catch (e) {
      resolve("");
    }
  });
})()
`;

  const result = await Application.executeInWebView({
    source: {
      html: "<html><head></head><body></body></html>",
      baseUrl: BASE_URL,
      loadCSS: false,
      loadImages: false,
    },
    inject,
    storage: { cookies: [] },
  });

  const b64 = String(result.result || "");
  if (!b64) return data;

  const decoded = Application.base64Decode(b64);
  if (typeof decoded === "string") {
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out.buffer;
  }
  return decoded;
}

export const Coolmic = new CoolmicExtension();
