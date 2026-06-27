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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import { descrambleViz } from "../utils/descramble/canvas";

const BASE_URL = "https://www.viz.com";
// VizFactory exposes two services ("shonenjump" and "vizmanga"). The "vizmanga"
// free-chapters section now redirects to the geo-gated landing page (returns no
// chapters), so this standalone ports the working "shonenjump" catalog.
const SERVICE_PATH = "shonenjump";
// VIZ moved the section listing from /read/ to /manga-books/. Manga detail and
// chapter pages still live at /<service>/chapters/... (no manga-books prefix).
const FREE_CHAPTERS_URL = `${BASE_URL}/manga-books/${SERVICE_PATH}/section/free-chapters`;

// Endpoint that returns the (short-lived) signed URL of the scrambled page image.
const IMAGE_URL_ENDPOINT = "get_manga_url";

// EXIF dimension fallbacks taken verbatim from VizImageInterceptor.kt. The
// cell-grid geometry now lives in descrambleViz (shared canvas helper).
const COMMON_WIDTH = 800;
const COMMON_HEIGHT = 1200;

const DATE_REGEX = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

class VIZInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/${SERVICE_PATH}`,
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

    // The page "image" request is actually the get_manga_url JSON endpoint.
    // Its response is `{ "data": { "0": "<signed scrambled JPEG url>" } }`.
    // We resolve the signed URL, fetch the scrambled JPEG, parse its EXIF key
    // and descramble it on a canvas — mirroring VizImageInterceptor.kt.
    if (!request.url.includes(IMAGE_URL_ENDPOINT)) {
      return data;
    }

    try {
      const imageUrl = parsePageImageUrl(data);
      if (!imageUrl) return data;

      const userAgent = await Application.getDefaultUserAgent();
      const [imgResponse, imgData] = await Application.scheduleRequest({
        url: imageUrl,
        method: "GET",
        headers: {
          accept: "*/*",
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          "user-agent": userAgent,
        },
      });
      if (imgResponse.status < 200 || imgResponse.status >= 300) {
        return data;
      }

      const contentType =
        imgResponse.headers?.["content-type"] ||
        imgResponse.headers?.["Content-Type"] ||
        "image/jpeg";
      const mimeType = contentType.split(";")[0].trim() || "image/jpeg";

      const decoded = await decodeImage(imgData, mimeType);
      return decoded ?? imgData;
    } catch {
      // Never throw out of interceptResponse — fall back to the raw JSON
      // body (which the reader will simply fail to render) rather than
      // breaking the whole chapter.
      return data;
    }
  }
}

type VIZImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class VIZExtension implements VIZImplementation {
  requestManager = new VIZInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
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
        id: "free",
        title: "Free Chapters",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const series = await this.fetchSeriesList();
    const items: DiscoverSectionItem[] = series.map((s) => ({
      type: "featuredCarouselItem",
      mangaId: s.mangaId,
      imageUrl: s.imageUrl,
      title: s.title,
      metadata: undefined,
    }));
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
    const series = await this.fetchSeriesList();

    const results: SearchResultItem[] = series
      .filter(
        (s) => titleQuery === "" || s.title.toLowerCase().includes(titleQuery),
      )
      .map((s) => ({
        mangaId: s.mangaId,
        imageUrl: s.imageUrl,
        title: s.title,
        subtitle: undefined,
        metadata: undefined,
      }));

    return { items: results, metadata: undefined };
  }

  private async fetchSeriesList(): Promise<
    { mangaId: string; title: string; imageUrl: string }[]
  > {
    const [response, data] = await Application.scheduleRequest({
      url: FREE_CHAPTERS_URL,
      method: "GET",
    });
    // VIZ redirects the free-chapters section to the landing page when the
    // service/region isn't supported. Mirrors keiyoushi's COUNTRY_NOT_SUPPORTED.
    if (!response.url.includes("section/free-chapters")) {
      throw new Error("Your country is not supported by the service.");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const $ = cheerio.load(htmlparser2.parseDocument(htmlStr));

    const out: { mangaId: string; title: string; imageUrl: string }[] = [];
    const seen = new Set<string>();
    $(
      "section.section_chapters div.o_sort_container div.o_sortable > a.o_chapters-link",
    ).each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      seen.add(mangaId);
      const title = el.find("div.pad-x-rg").first().text().trim();
      const imageUrl = this.imageFromElement(
        el.find("div.pos-r img.disp-bl").first(),
      );
      if (!title) return;
      out.push({ mangaId, title, imageUrl });
    });

    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const seriesIntro = $("section#series-intro").first();

    const author =
      seriesIntro
        .find("div.type-rg span")
        .first()
        .text()
        .replace("Created by ", "")
        .trim() || undefined;
    const synopsis = seriesIntro.find("div.line-solid").first().text().trim();

    let thumbnailUrl = this.imageFromElement(
      $("section.section_chapters td a > img").first(),
    );
    if (!thumbnailUrl) {
      thumbnailUrl = this.imageFromElement(seriesIntro.find("img").first());
    }

    const title =
      seriesIntro.find("h2.type-lg").first().text().trim() ||
      this.safeDecode(mangaId);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author,
        artist: author,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
        tagGroups: [],
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $(
      "section.section_chapters div.o_sortable > a.o_chapter-container, section.section_chapters div.o_sortable div.o_chapter-vol-container tr.o_chapter a.o_chapter-container",
    ).each((_, element) => {
      const el = $(element);

      const isVolume = el.find("div:nth-child(1) table").length === 0;
      let name: string;
      let publishDate = new Date(0);

      if (isVolume) {
        name = el.text().trim();
      } else {
        const rightSide = el.find("div:nth-child(2) table").first();
        name = rightSide.find("td").first().text().trim();
        const dateStr = el
          .find("div:nth-child(1) table td[align=right]")
          .first()
          .text()
          .trim();
        publishDate = this.parseDate(dateStr);
      }

      const targetUrl = el.attr("data-target-url") || "";
      // Only free (non-locked) chapters are reachable without a login; locked
      // ones use a "javascript:" target which we skip.
      if (!targetUrl || targetUrl.startsWith("javascript")) return;

      const chapterId = this.parsePath(targetUrl);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name),
        publishDate,
        langCode: "🇬🇧",
      });
    });

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    let pageCount = 0;
    $("script").each((_, element) => {
      const data = $(element).html() || "";
      if (data.includes("var pages")) {
        const m = data.match(/var\s+pages\s*=\s*(\d+)/);
        if (m) pageCount = parseInt(m[1], 10);
      }
    });

    const mangaId = url.replace(/[?#].*$/, "").split("/").pop() || "";

    const pages: string[] = [];
    for (let i = 0; i <= pageCount; i++) {
      const params = [
        "device_id=3",
        `manga_id=${encodeURIComponent(mangaId)}`,
        `pages=${i}`,
      ].join("&");
      // The interceptor resolves this JSON endpoint into the real (scrambled)
      // image, parses its EXIF key and descrambles it before returning bytes.
      pages.push(`${BASE_URL}/manga/${IMAGE_URL_ENDPOINT}?${params}`);
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

  private parseChapterNumber(name: string): number {
    const after = name.includes("Ch. ") ? name.split("Ch. ")[1] : name;
    const m = (after || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : -1;
  }

  private parseDate(dateStr: string): Date {
    const m = (dateStr || "").match(DATE_REGEX);
    if (!m) return new Date(0);
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) return new Date(0);
    return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-original") ||
      img.attr("data-src") ||
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
}

// --------------------------------------------------------------------
// Page image resolution + descrambling (module-level helpers)
// --------------------------------------------------------------------

type ExifImageData = {
  width: number;
  height: number;
  // The descramble key: a flat list of integers parsed from the
  // EXIF ImageUniqueId tag ("hex:hex:hex…").
  key: number[];
};

// Parse the get_manga_url JSON body and return the first signed image URL.
function parsePageImageUrl(data: ArrayBuffer): string {
  const text = Application.arrayBufferToUTF8String(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null) return "";
  const dataField = (parsed as { data?: unknown }).data;
  if (typeof dataField !== "object" || dataField === null) return "";
  for (const value of Object.values(dataField as Record<string, unknown>)) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

// Read the EXIF SubIFD from a JPEG and extract the ImageUniqueId descramble
// key plus the (real) PixelX/Y dimensions. Mirrors getImageData() in
// VizImageInterceptor.kt. Returns null when no key is present.
function parseExifImageData(data: ArrayBuffer): ExifImageData | null {
  const bytes = new Uint8Array(data);

  // JPEG must start with SOI (FFD8).
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  // Locate the APP1 (FFE1) segment containing the "Exif\0\0" header.
  let offset = 2;
  let exifStart = -1;
  let exifLength = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    // Standalone markers without a length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segLen < 2) break;
    const segStart = offset + 4;
    if (marker === 0xe1 && segStart + 6 <= bytes.length) {
      // "Exif\0\0"
      if (
        bytes[segStart] === 0x45 &&
        bytes[segStart + 1] === 0x78 &&
        bytes[segStart + 2] === 0x69 &&
        bytes[segStart + 3] === 0x66 &&
        bytes[segStart + 4] === 0x00 &&
        bytes[segStart + 5] === 0x00
      ) {
        exifStart = segStart + 6;
        exifLength = segLen - 2 - 6;
        break;
      }
    }
    if (marker === 0xda) break; // start of scan — no metadata beyond here
    offset = segStart + (segLen - 2);
  }

  if (exifStart < 0 || exifLength <= 8) return null;

  // TIFF header (byte order + magic + IFD0 offset).
  const tiff = exifStart;
  let little: boolean;
  if (bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49) {
    little = true; // "II"
  } else if (bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d) {
    little = false; // "MM"
  } else {
    return null;
  }

  const u16 = (p: number): number =>
    little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1];
  const u32 = (p: number): number =>
    (little
      ? bytes[p] |
        (bytes[p + 1] << 8) |
        (bytes[p + 2] << 16) |
        (bytes[p + 3] << 24)
      : (bytes[p] << 24) |
        (bytes[p + 1] << 16) |
        (bytes[p + 2] << 8) |
        bytes[p + 3]) >>> 0;

  const ifd0Offset = u32(tiff + 4);
  const exifEnd = exifStart + exifLength;

  // EXIF tags of interest (located in the Exif SubIFD).
  const TAG_EXIF_IFD = 0x8769;
  const TAG_PIXEL_X = 0xa002; // ImageWidth
  const TAG_PIXEL_Y = 0xa003; // ImageHeight
  const TAG_UNIQUE_ID = 0xa420; // ImageUniqueID

  type TagValue = { type: number; count: number; valueOffset: number };

  const readIfd = (ifdAbs: number): Map<number, TagValue> => {
    const tags = new Map<number, TagValue>();
    if (ifdAbs + 2 > exifEnd) return tags;
    const count = u16(ifdAbs);
    let p = ifdAbs + 2;
    for (let i = 0; i < count; i++) {
      if (p + 12 > exifEnd) break;
      const tag = u16(p);
      const type = u16(p + 2);
      const cnt = u32(p + 4);
      // Field value (or pointer to it) sits in the last 4 bytes of the entry.
      const valueOffset = p + 8;
      tags.set(tag, { type, count: cnt, valueOffset });
      p += 12;
    }
    return tags;
  };

  const typeSize = (type: number): number => {
    switch (type) {
      case 1: // BYTE
      case 2: // ASCII
      case 7: // UNDEFINED
        return 1;
      case 3: // SHORT
        return 2;
      case 4: // LONG
      case 9: // SLONG
        return 4;
      case 5: // RATIONAL
      case 10:
        return 8;
      default:
        return 1;
    }
  };

  // For a tag whose payload exceeds 4 bytes, the entry holds an offset
  // (relative to the TIFF header); otherwise the value is inline.
  const dataPointer = (tv: TagValue): number => {
    const total = typeSize(tv.type) * tv.count;
    if (total <= 4) return tv.valueOffset;
    return tiff + u32(tv.valueOffset);
  };

  const readNumber = (tv: TagValue): number => {
    const p = dataPointer(tv);
    if (tv.type === 3) return u16(p);
    if (tv.type === 4) return u32(p);
    return u32(p);
  };

  const readAscii = (tv: TagValue): string => {
    const p = dataPointer(tv);
    let s = "";
    for (let i = 0; i < tv.count; i++) {
      if (p + i >= exifEnd) break;
      const c = bytes[p + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const ifd0 = readIfd(tiff + ifd0Offset);
  const exifPtr = ifd0.get(TAG_EXIF_IFD);
  if (!exifPtr) return null;
  const exifIfd = readIfd(tiff + readNumber(exifPtr));

  const uniqueTv = exifIfd.get(TAG_UNIQUE_ID);
  if (!uniqueTv) return null;
  const uniqueId = readAscii(uniqueTv);
  if (!uniqueId) return null;

  const key = uniqueId
    .split(":")
    .map((h) => parseInt(h, 16))
    .filter((n) => !isNaN(n));
  if (key.length === 0) return null;

  let width = COMMON_WIDTH;
  let height = COMMON_HEIGHT;
  const wTv = exifIfd.get(TAG_PIXEL_X);
  const hTv = exifIfd.get(TAG_PIXEL_Y);
  if (wTv) {
    const w = readNumber(wTv);
    if (w > 0) width = w;
  }
  if (hTv) {
    const h = readNumber(hTv);
    if (h > 0) height = h;
  }

  return { width, height, key };
}

// Descramble a VIZ page image using its EXIF key on the polyfilled canvas,
// in-process. Returns null on any failure so the caller can fall back to the
// raw bytes. Geometry is a faithful port of VizImageInterceptor.kt.
async function decodeImage(
  data: ArrayBuffer,
  mimeType: string,
): Promise<ArrayBuffer | null> {
  const imageData = parseExifImageData(data);
  // No key → the served bytes are already a plain (unscrambled) JPEG.
  if (!imageData) return null;

  try {
    return await descrambleViz(
      data,
      mimeType,
      imageData.key,
      imageData.width,
      imageData.height,
    );
  } catch {
    return null;
  }
}

export const VIZ = new VIZExtension();
