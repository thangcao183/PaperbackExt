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
import { remapKMangaCells } from "../utils/descramble/canvas";

const DOMAIN = "kmanga.kodansha.com";
const BASE_URL = `https://${DOMAIN}`;
const API_URL = `https://api.${DOMAIN}`;
const PAGE_LIMIT = 25;

// Default birthday cookie values for logged-out users (mirrors the Kotlin source).
const DEFAULT_BIRTHDAY = "2000-01";

const GENRES: { name: string; id: string }[] = [
  { name: "Romance･Romcom", id: "1" },
  { name: "Horror･Mystery･Suspense", id: "2" },
  { name: "Gag･Comedy･Slice-of-Life", id: "3" },
  { name: "SF･Fantasy", id: "4" },
  { name: "Sports", id: "5" },
  { name: "Drama", id: "6" },
  { name: "Outlaws･Underworld･Punks", id: "7" },
  { name: "Action･Battle", id: "8" },
  { name: "Isekai･Super Powers", id: "9" },
  { name: "One-off Books", id: "10" },
  { name: "Shojo/josei", id: "11" },
  { name: "Yaoi/BL", id: "12" },
  { name: "LGBTQ", id: "13" },
  { name: "Yuri/GL", id: "14" },
  { name: "Anime", id: "15" },
  { name: "Award Winner", id: "16" },
];

const CHAPTER_NAME_REGEX =
  /(?:chapter|ch|episode|ep|第).?\s*(\d+(?:\.\d+)?)(?:\s*[(（](\d+)[)）])?/i;
const SPLIT_CHAPTER_REGEX = /(\d+(?:\.\d+)?)\s*[(（](\d+)[)）]/;
const FALLBACK_CHAPTER_REGEX = /^(\d+(?:\.\d+)?)(?:\s*[(（](\d+)[)）])?/;

// ----------------------------------------------------------------
// JSON API response shapes (mirrors Dto.kt)
// ----------------------------------------------------------------

interface RankingApiResponse {
  ranking_title_list?: { id: number }[];
}

interface TitleDetail {
  title_id: number;
  title_name: string;
  thumbnail_image_url?: string | null;
  banner_image_url?: string | null;
  thumbnail_rect_image_url?: string | null;
}

interface TitleListResponse {
  title_list?: TitleDetail[];
}

interface WebTitle {
  title_name: string;
  author_text?: string | null;
  introduction_text?: string | null;
  next_updated_text?: string | null;
  title_in_japanese?: string | null;
  genre_id_list?: number[] | null;
  episode_id_list?: number[];
  thumbnail_image_url?: string | null;
  thumbnail_rect_image_url?: string | null;
  banner_image_url?: string | null;
}

interface DetailResponse {
  web_title: WebTitle;
}

interface GenreListResponse {
  genre_list?: { genre_name: string }[] | null;
}

interface EpisodeListResponse {
  episode_list?: EpisodeDto[];
}

interface EpisodeDto {
  episode_id: number;
  episode_name: string;
  start_time?: string | null;
  point: number;
  title_id: number;
  index: number;
  badge: number;
  rental_finish_time?: string | null;
}

interface ViewerApiResponse {
  page_list?: string[];
  scramble_seed?: number;
}

// ================================================================
// SHA-256 / SHA-512 (pure TS).
//
// The K Manga API requires an `x-kmanga-hash` header on every request,
// computed from the sorted request parameters and the `birthday` cookie.
// The Paperback runtime only exposes md5 (Application.crypto_md5Hash), so
// the SHA primitives are implemented here to reproduce the hash exactly.
// ================================================================

function utf8Bytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function toHex(bytes: number[]): string {
  let out = "";
  for (const b of bytes) out += (b & 0xff).toString(16).padStart(2, "0");
  return out;
}

// --- SHA-256 ---

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(message: string): string {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  const bytes = utf8Bytes(message);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit length (high 32 bits assumed 0 for our input sizes).
  for (let i = 7; i >= 0; i--) {
    bytes.push((Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff) >>> 0);
  }

  const w = new Array<number>(64);
  const rotr = (x: number, n: number) =>
    ((x >>> n) | (x << (32 - n))) >>> 0;

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[off + i * 4] << 24) |
          (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) |
          bytes[off + i * 4 + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 =
        (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (((w[i - 16] + s0) >>> 0) + ((w[i - 7] + s1) >>> 0)) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (((hh + S1) >>> 0) + ((ch + SHA256_K[i]) >>> 0) + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let out = "";
  for (const v of h) out += (v >>> 0).toString(16).padStart(8, "0");
  return out;
}

// --- SHA-512 (64-bit ops via [hi, lo] pairs) ---

type U64 = [number, number]; // [high32, low32]

const SHA512_K: U64[] = [
  [0x428a2f98, 0xd728ae22], [0x71374491, 0x23ef65cd],
  [0xb5c0fbcf, 0xec4d3b2f], [0xe9b5dba5, 0x8189dbbc],
  [0x3956c25b, 0xf348b538], [0x59f111f1, 0xb605d019],
  [0x923f82a4, 0xaf194f9b], [0xab1c5ed5, 0xda6d8118],
  [0xd807aa98, 0xa3030242], [0x12835b01, 0x45706fbe],
  [0x243185be, 0x4ee4b28c], [0x550c7dc3, 0xd5ffb4e2],
  [0x72be5d74, 0xf27b896f], [0x80deb1fe, 0x3b1696b1],
  [0x9bdc06a7, 0x25c71235], [0xc19bf174, 0xcf692694],
  [0xe49b69c1, 0x9ef14ad2], [0xefbe4786, 0x384f25e3],
  [0x0fc19dc6, 0x8b8cd5b5], [0x240ca1cc, 0x77ac9c65],
  [0x2de92c6f, 0x592b0275], [0x4a7484aa, 0x6ea6e483],
  [0x5cb0a9dc, 0xbd41fbd4], [0x76f988da, 0x831153b5],
  [0x983e5152, 0xee66dfab], [0xa831c66d, 0x2db43210],
  [0xb00327c8, 0x98fb213f], [0xbf597fc7, 0xbeef0ee4],
  [0xc6e00bf3, 0x3da88fc2], [0xd5a79147, 0x930aa725],
  [0x06ca6351, 0xe003826f], [0x14292967, 0x0a0e6e70],
  [0x27b70a85, 0x46d22ffc], [0x2e1b2138, 0x5c26c926],
  [0x4d2c6dfc, 0x5ac42aed], [0x53380d13, 0x9d95b3df],
  [0x650a7354, 0x8baf63de], [0x766a0abb, 0x3c77b2a8],
  [0x81c2c92e, 0x47edaee6], [0x92722c85, 0x1482353b],
  [0xa2bfe8a1, 0x4cf10364], [0xa81a664b, 0xbc423001],
  [0xc24b8b70, 0xd0f89791], [0xc76c51a3, 0x0654be30],
  [0xd192e819, 0xd6ef5218], [0xd6990624, 0x5565a910],
  [0xf40e3585, 0x5771202a], [0x106aa070, 0x32bbd1b8],
  [0x19a4c116, 0xb8d2d0c8], [0x1e376c08, 0x5141ab53],
  [0x2748774c, 0xdf8eeb99], [0x34b0bcb5, 0xe19b48a8],
  [0x391c0cb3, 0xc5c95a63], [0x4ed8aa4a, 0xe3418acb],
  [0x5b9cca4f, 0x7763e373], [0x682e6ff3, 0xd6b2b8a3],
  [0x748f82ee, 0x5defb2fc], [0x78a5636f, 0x43172f60],
  [0x84c87814, 0xa1f0ab72], [0x8cc70208, 0x1a6439ec],
  [0x90befffa, 0x23631e28], [0xa4506ceb, 0xde82bde9],
  [0xbef9a3f7, 0xb2c67915], [0xc67178f2, 0xe372532b],
  [0xca273ece, 0xea26619c], [0xd186b8c7, 0x21c0c207],
  [0xeada7dd6, 0xcde0eb1e], [0xf57d4f7f, 0xee6ed178],
  [0x06f067aa, 0x72176fba], [0x0a637dc5, 0xa2c898a6],
  [0x113f9804, 0xbef90dae], [0x1b710b35, 0x131c471b],
  [0x28db77f5, 0x23047d84], [0x32caab7b, 0x40c72493],
  [0x3c9ebe0a, 0x15c9bebc], [0x431d67c4, 0x9c100d4c],
  [0x4cc5d4be, 0xcb3e42b6], [0x597f299c, 0xfc657e2a],
  [0x5fcb6fab, 0x3ad6faec], [0x6c44198c, 0x4a475817],
];

function add64(a: U64, b: U64): U64 {
  const lo = (a[1] >>> 0) + (b[1] >>> 0);
  const hi = (a[0] >>> 0) + (b[0] >>> 0) + (lo > 0xffffffff ? 1 : 0);
  return [hi >>> 0, lo >>> 0];
}
function xor64(a: U64, b: U64): U64 {
  return [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0];
}
function and64(a: U64, b: U64): U64 {
  return [(a[0] & b[0]) >>> 0, (a[1] & b[1]) >>> 0];
}
function not64(a: U64): U64 {
  return [~a[0] >>> 0, ~a[1] >>> 0];
}
function rotr64(x: U64, n: number): U64 {
  if (n === 0) return [x[0], x[1]];
  if (n === 32) return [x[1], x[0]];
  if (n < 32) {
    const hi = ((x[0] >>> n) | (x[1] << (32 - n))) >>> 0;
    const lo = ((x[1] >>> n) | (x[0] << (32 - n))) >>> 0;
    return [hi, lo];
  }
  const m = n - 32;
  const hi = ((x[1] >>> m) | (x[0] << (32 - m))) >>> 0;
  const lo = ((x[0] >>> m) | (x[1] << (32 - m))) >>> 0;
  return [hi, lo];
}
function shr64(x: U64, n: number): U64 {
  if (n === 0) return [x[0], x[1]];
  if (n < 32) {
    const hi = x[0] >>> n;
    const lo = ((x[1] >>> n) | (x[0] << (32 - n))) >>> 0;
    return [hi, lo];
  }
  return [0, x[0] >>> (n - 32)];
}

function sha512Hex(message: string): string {
  const h: U64[] = [
    [0x6a09e667, 0xf3bcc908], [0xbb67ae85, 0x84caa73b],
    [0x3c6ef372, 0xfe94f82b], [0xa54ff53a, 0x5f1d36f1],
    [0x510e527f, 0xade682d1], [0x9b05688c, 0x2b3e6c1f],
    [0x1f83d9ab, 0xfb41bd6b], [0x5be0cd19, 0x137e2179],
  ];

  const bytes = utf8Bytes(message);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 128 !== 112) bytes.push(0);
  // 128-bit big-endian length (high bits 0 for our input sizes).
  for (let i = 15; i >= 0; i--) {
    bytes.push((Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff) >>> 0);
  }

  const w: U64[] = new Array(80);
  for (let off = 0; off < bytes.length; off += 128) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 8;
      const hi =
        ((bytes[j] << 24) |
          (bytes[j + 1] << 16) |
          (bytes[j + 2] << 8) |
          bytes[j + 3]) >>>
        0;
      const lo =
        ((bytes[j + 4] << 24) |
          (bytes[j + 5] << 16) |
          (bytes[j + 6] << 8) |
          bytes[j + 7]) >>>
        0;
      w[i] = [hi, lo];
    }
    for (let i = 16; i < 80; i++) {
      const s0 = xor64(
        xor64(rotr64(w[i - 15], 1), rotr64(w[i - 15], 8)),
        shr64(w[i - 15], 7),
      );
      const s1 = xor64(
        xor64(rotr64(w[i - 2], 19), rotr64(w[i - 2], 61)),
        shr64(w[i - 2], 6),
      );
      w[i] = add64(add64(w[i - 16], s0), add64(w[i - 7], s1));
    }

    let a = h[0],
      b = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      hh = h[7];

    for (let i = 0; i < 80; i++) {
      const S1 = xor64(
        xor64(rotr64(e, 14), rotr64(e, 18)),
        rotr64(e, 41),
      );
      const ch = xor64(and64(e, f), and64(not64(e), g));
      const t1 = add64(add64(hh, S1), add64(ch, add64(SHA512_K[i], w[i])));
      const S0 = xor64(
        xor64(rotr64(a, 28), rotr64(a, 34)),
        rotr64(a, 39),
      );
      const maj = xor64(xor64(and64(a, b), and64(a, c)), and64(b, c));
      const t2 = add64(S0, maj);
      hh = g;
      g = f;
      f = e;
      e = add64(d, t1);
      d = c;
      c = b;
      b = a;
      a = add64(t1, t2);
    }

    h[0] = add64(h[0], a);
    h[1] = add64(h[1], b);
    h[2] = add64(h[2], c);
    h[3] = add64(h[3], d);
    h[4] = add64(h[4], e);
    h[5] = add64(h[5], f);
    h[6] = add64(h[6], g);
    h[7] = add64(h[7], hh);
  }

  let out = "";
  for (const v of h) {
    out += (v[0] >>> 0).toString(16).padStart(8, "0");
    out += (v[1] >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

// ----------------------------------------------------------------
// Interceptor
// ----------------------------------------------------------------

class KMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "x-kmanga-platform": "3",
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json, text/plain, */*",
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

    // Scrambled page images carry their xorshift32 seed in the URL fragment.
    const fragment = request.url.split("#")[1] ?? "";
    if (fragment.startsWith("scramble_seed=")) {
      const seedStr = fragment.slice("scramble_seed=".length);
      const seed = parseInt(seedStr, 10);
      // seed === 0 means the image is not scrambled; pass it through.
      if (Number.isFinite(seed) && seed !== 0) {
        try {
          const contentType = response.headers?.["content-type"] ?? "";
          const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
          return await unscrambleImage(data, seed >>> 0, mimeType);
        } catch {
          // On any failure, return the original (scrambled) bytes rather
          // than nothing — never throw out of interceptResponse.
          return data;
        }
      }
    }

    return data;
  }
}

type KMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

interface KMangaMetadata {
  page?: number;
  genre?: string;
}

export class KMangaExtension implements KMangaImplementation {
  requestManager = new KMangaInterceptor("main");
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
        searchQuery: {
          title: "",
          metadata: { genre: g.id },
        },
        name: g.name,
        metadata: { genre: g.id },
      }));
      return { items, metadata: undefined };
    }

    if (section.id === "popular") {
      const meta = metadata as KMangaMetadata | undefined;
      const page = meta?.page ?? 1;
      const titles = await this.fetchPopular(page);
      const items: DiscoverSectionItem[] = titles.list.map((t) =>
        this.titleToDiscoverItem(t, "featuredCarouselItem"),
      );
      return {
        items,
        metadata: titles.hasNext ? { page: page + 1 } : undefined,
      };
    }

    // latest
    const titles = await this.fetchLatest();
    const items: DiscoverSectionItem[] = titles.map((t) =>
      this.titleToDiscoverItem(t, "simpleCarouselItem"),
    );
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as KMangaMetadata | undefined;
    const titleQuery = (query.title || "").trim();

    // Direct id / url handling (mirrors PREFIX_SEARCH "id:" + url paste).
    let directId: string | undefined;
    if (titleQuery.startsWith("https://")) {
      const m = titleQuery.match(/\/title\/(\d+)/);
      if (m) directId = m[1];
    } else if (titleQuery.startsWith("id:")) {
      directId = titleQuery.slice(3).trim();
    }
    if (directId) {
      const manga = await this.getMangaDetails(`title/${directId}`);
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

    const queryMeta = query.metadata as KMangaMetadata | undefined;
    const genre = queryMeta?.genre ?? meta?.genre;

    const params: Record<string, string> = { limit: "99999" };
    if (titleQuery) {
      params.keyword = titleQuery;
    } else if (genre) {
      params.genre_id = genre;
    }

    const data = await this.hashedGetJson<TitleListResponse>(
      `${API_URL}/search/title`,
      params,
    );

    const items: SearchResultItem[] = (data.title_list ?? []).map((t) => ({
      mangaId: `title/${t.title_id}`,
      imageUrl: this.pickThumb(t),
      title: t.title_name,
      subtitle: undefined,
      metadata: undefined,
    }));

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const titleId = this.titleIdFromMangaId(mangaId);
    const data = await this.hashedGetJson<DetailResponse>(
      `${API_URL}/web/title/detail`,
      { title_id: titleId },
    );
    const t = data.web_title;

    let synopsis = t.introduction_text ?? "";
    if (t.next_updated_text && t.next_updated_text.trim()) {
      synopsis += `\n\n${t.next_updated_text}`;
    }
    if (t.title_in_japanese && t.title_in_japanese.trim()) {
      synopsis += `\n\nJapanese Title: ${t.title_in_japanese}`;
    }

    const thumbnailUrl =
      t.thumbnail_image_url ||
      t.banner_image_url ||
      t.thumbnail_rect_image_url ||
      "";

    const tagGroups: TagSection[] = [];
    if (t.genre_id_list && t.genre_id_list.length > 0) {
      try {
        const genreData = await this.hashedGetJson<GenreListResponse>(
          `${API_URL}/genre/list`,
          { genre_id_list: t.genre_id_list.join(", ") },
        );
        const genreList = genreData.genre_list ?? [];
        if (genreList.length > 0) {
          tagGroups.push({
            id: "genres",
            title: "Genres",
            tags: genreList.map((g) => ({
              id: g.genre_name.toLowerCase().replace(/\s+/g, "-"),
              title: g.genre_name,
            })),
          });
        }
      } catch {
        // Genre lookup is best-effort.
      }
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: t.title_name,
        secondaryTitles: t.title_in_japanese ? [t.title_in_japanese] : [],
        thumbnailUrl,
        author: t.author_text ?? undefined,
        artist: t.author_text ?? undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const titleId = this.titleIdFromMangaId(sourceManga.mangaId);
    const detail = await this.hashedGetJson<DetailResponse>(
      `${API_URL}/web/title/detail`,
      { title_id: titleId },
    );
    const episodeIds = (detail.web_title.episode_id_list ?? []).map((id) =>
      id.toString(),
    );
    if (episodeIds.length === 0) return [];

    const body = `episode_id_list=${encodeURIComponent(episodeIds.join(","))}`;
    const params = { episode_id_list: episodeIds.join(",") };
    const hash = this.generateHash(params);

    const [response, data] = await Application.scheduleRequest({
      url: `${API_URL}/episode/list`,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-kmanga-hash": hash,
      },
      body,
    });
    if (response.status === 404) throw new Error("Content not found");
    const result = JSON.parse(
      Application.arrayBufferToUTF8String(data),
    ) as EpisodeListResponse;

    const episodes = result.episode_list ?? [];
    const chapters: Chapter[] = episodes.map((ep) => {
      const locked = this.isLocked(ep);
      const parsed = this.parseEpisodeName(ep.episode_name, ep.index);
      const title = (locked ? "🔒 " : "") + parsed.name;
      return {
        chapterId: `title/${ep.title_id}/episode/${ep.episode_id}`,
        sourceManga,
        title,
        volume: 0,
        chapNum: parsed.chapNum,
        publishDate: this.parseDate(ep.start_time),
        langCode: "🇬🇧",
      };
    });

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const episodeId = this.episodeIdFromChapterId(chapter.chapterId);
    const data = await this.hashedGetJson<ViewerApiResponse>(
      `${API_URL}/web/episode/viewer`,
      { episode_id: episodeId },
    );
    const seed = data.scramble_seed ?? 0;
    // K Manga page images are block-scrambled: a 4x4 grid of cells in the
    // top-left region is shuffled by an xorshift32 permutation keyed by
    // scramble_seed. The seed is carried in the URL fragment and the
    // interceptor unscrambles the bytes via a canvas drawImage cell remap
    // (mirrors upstream ImageInterceptor.kt / the Mangago descramble path).
    const pages = (data.page_list ?? []).map(
      (p) => `${p}#scramble_seed=${seed}`,
    );

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
  // API fetch helpers
  // ----------------------------------------------------------------

  private async fetchPopular(
    page: number,
  ): Promise<{ list: TitleDetail[]; hasNext: boolean }> {
    const offset = (page - 1) * PAGE_LIMIT;
    const ranking = await this.hashedGetJson<RankingApiResponse>(
      `${API_URL}/ranking/all`,
      {
        ranking_id: "12",
        offset: offset.toString(),
        limit: (PAGE_LIMIT + 1).toString(),
      },
    );
    const ids = (ranking.ranking_title_list ?? []).map((r) => r.id.toString());
    if (ids.length === 0) return { list: [], hasNext: false };

    const hasNext = ids.length > PAGE_LIMIT;
    const idsToFetch = hasNext ? ids.slice(0, -1) : ids;

    const details = await this.hashedGetJson<TitleListResponse>(
      `${API_URL}/title/list`,
      { title_id_list: idsToFetch.join(",") },
    );
    const list = (details.title_list ?? []).slice().reverse();
    return { list, hasNext };
  }

  private async fetchLatest(): Promise<TitleDetail[]> {
    const out: TitleDetail[] = [];
    let dayOffset = 0;
    // Bounded loop: walk back day-by-day until a day returns no updates.
    while (dayOffset < 14) {
      const dateString = this.jstDateString(dayOffset);
      const data = await this.hashedGetJson<TitleListResponse>(
        `${API_URL}/web/top/updated/title`,
        { base_date: dateString },
      );
      const list = data.title_list ?? [];
      if (list.length === 0) break;
      out.push(...list.slice().reverse());
      dayOffset++;
    }
    return out;
  }

  private titleToDiscoverItem(
    t: TitleDetail,
    type: "featuredCarouselItem" | "simpleCarouselItem",
  ): DiscoverSectionItem {
    return {
      type,
      mangaId: `title/${t.title_id}`,
      imageUrl: this.pickThumb(t),
      title: t.title_name,
      metadata: undefined,
    };
  }

  private pickThumb(t: TitleDetail): string {
    return (
      t.thumbnail_image_url ||
      t.banner_image_url ||
      t.thumbnail_rect_image_url ||
      ""
    );
  }

  // ----------------------------------------------------------------
  // Hashing (x-kmanga-hash)
  // ----------------------------------------------------------------

  private async hashedGetJson<T>(
    base: string,
    params: Record<string, string>,
  ): Promise<T> {
    const hash = this.generateHash(params);
    const query = Object.keys(params)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");
    const url = query ? `${base}?${query}` : base;

    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { "x-kmanga-hash": hash },
    });
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  private generateHash(params: Record<string, string>): string {
    const { birthday, expires } = this.getBirthday();
    const sortedKeys = Object.keys(params).sort();
    const paramStrings = sortedKeys.map((key) =>
      this.getHashedParam(key, params[key]),
    );
    const joined = paramStrings.join(",");
    const hash1 = sha256Hex(joined);
    const cookieHash = this.getHashedParam(birthday, expires);
    return sha512Hex(`${hash1}${cookieHash}`);
  }

  private getHashedParam(key: string, value: string): string {
    const keyHash = sha256Hex(key);
    const valueHash = sha512Hex(value);
    return `${keyHash}_${valueHash}`;
  }

  private getBirthday(): { birthday: string; expires: string } {
    const defaultExpires = (
      Math.floor(Date.now() / 1000) + 315360000
    ).toString();
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      if (cookie.name === "birthday" && cookie.value) {
        try {
          const decoded = this.safeDecode(cookie.value);
          const parsed = JSON.parse(decoded) as {
            value?: string;
            expires?: number;
          };
          if (parsed.value && parsed.expires !== undefined) {
            return {
              birthday: parsed.value,
              expires: parsed.expires.toString(),
            };
          }
        } catch {
          // Malformed cookie; fall through to default.
        }
      }
    }
    return { birthday: DEFAULT_BIRTHDAY, expires: defaultExpires };
  }

  // ----------------------------------------------------------------
  // Parsing helpers
  // ----------------------------------------------------------------

  private isLocked(ep: EpisodeDto): boolean {
    return ep.point > 0 && ep.badge !== 3 && !ep.rental_finish_time;
  }

  private parseEpisodeName(
    episodeName: string,
    index: number,
  ): { name: string; chapNum: number } {
    let name = episodeName;
    const match =
      episodeName.match(CHAPTER_NAME_REGEX) ||
      episodeName.match(SPLIT_CHAPTER_REGEX) ||
      episodeName.match(FALLBACK_CHAPTER_REGEX);

    let chapNum = index;
    if (match) {
      const main = match[1] ?? "";
      const part = match[2] ?? "";
      if (part) {
        const replacement = match[0].replace(/\s*[(（]\d+[)）]/, `.${part}`);
        name = name.replace(match[0], replacement);
        if (main.includes(".")) {
          const f = parseFloat(main);
          chapNum = isNaN(f) ? index : f;
        } else {
          const f = parseFloat(`${main}.${part}`);
          chapNum = isNaN(f) ? index : f;
        }
      } else {
        const f = parseFloat(main);
        chapNum = isNaN(f) ? index : f;
      }
    }
    return { name, chapNum };
  }

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    // Format: "yyyy-MM-dd HH:mm:ss"
    const m = value.match(
      /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
    );
    if (!m) return new Date(0);
    const d = new Date(
      Date.UTC(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10),
        parseInt(m[6], 10),
      ),
    );
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  private jstDateString(dayOffset: number): string {
    // Build a date in JST (UTC+9). Manga updates ~10 AM JST; if before that,
    // step back a day (mirrors the upstream logic).
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
    let target = new Date(nowJst.getTime() - dayOffset * 86400 * 1000);
    if (target.getUTCHours() < 10) {
      target = new Date(target.getTime() - 86400 * 1000);
    }
    const y = target.getUTCFullYear();
    const mo = (target.getUTCMonth() + 1).toString().padStart(2, "0");
    const da = target.getUTCDate().toString().padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }

  // ----------------------------------------------------------------
  // ID / URL helpers
  // ----------------------------------------------------------------

  private titleIdFromMangaId(mangaId: string): string {
    const slug = this.safeDecode(mangaId).replace(/^\/+/, "");
    const m = slug.match(/title\/(\d+)/);
    if (m) return m[1];
    const digits = slug.match(/\d+/);
    return digits ? digits[0] : slug;
  }

  private episodeIdFromChapterId(chapterId: string): string {
    const slug = this.safeDecode(chapterId).replace(/^\/+/, "");
    const m = slug.match(/episode\/(\d+)/);
    if (m) return m[1];
    const all = slug.match(/\d+/g);
    return all && all.length > 0 ? all[all.length - 1] : slug;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
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
}

// ================================================================
// Page-image descrambling
//
// K Manga shuffles a 4x4 grid of cells in the top-left region of each
// page image. The permutation is derived from a per-chapter `scramble_seed`
// via xorshift32, exactly as in upstream ImageInterceptor.kt. We compute the
// (dimension-independent) cell permutation here in TS, then perform the
// pixel remap directly in-process via the polyfilled canvas (see
// remapKMangaCells in utils/descramble/canvas) — no Application.executeInWebView
// round-trip, which was unreliable and ignored Paperback's Y-up getImageData.
// ================================================================

// 32-bit xorshift, matching the Kotlin UInt implementation.
function xorshift32(seed: number): number {
  let n = seed >>> 0;
  n = (n ^ (n << 13)) >>> 0;
  n = (n ^ (n >>> 17)) >>> 0;
  n = (n ^ (n << 5)) >>> 0;
  return n >>> 0;
}

// Returns the source cell index (0..15) for each destination cell index
// (0..15), where cell layout is row-major over a 4x4 grid.
function getSourceCellOrder(seed: number): number[] {
  let seed32 = seed >>> 0;
  const pairs: { value: number; index: number }[] = [];
  for (let i = 0; i < 16; i++) {
    seed32 = xorshift32(seed32);
    pairs.push({ value: seed32 >>> 0, index: i });
  }
  // Sort by the unsigned xorshift value (stable on equal values, matching
  // Kotlin's stable sortBy). `value` is already >>> 0 so plain numeric
  // comparison is an unsigned comparison.
  pairs.sort((a, b) => a.value - b.value);
  // sortedVal[i] is the original index that lands at sorted position i.
  // CoordPair: source = sortedVal[i], dest = i.
  return pairs.map((p) => p.index);
}

async function unscrambleImage(
  data: ArrayBuffer,
  seed: number,
  mimeType: string,
): Promise<ArrayBuffer> {
  const sourceOrder = getSourceCellOrder(seed);
  return await remapKMangaCells(data, mimeType, sourceOrder);
}

export const KManga = new KMangaExtension();
