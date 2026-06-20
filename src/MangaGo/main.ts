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
import type { Element } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://www.mangago.me";
const DOMAIN = "mangago.me";

// Regular expressions taken verbatim from the keiyoushi Mangago source.
const IMG_SRCS_REGEX = /var imgsrcs\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/;
const COLS_REGEX = /var\s*widthnum\s*=\s*heightnum\s*=\s*(\d+);/;
const KEY_LOCATION_REGEX = /str\.charAt\(\s*(\d+)\s*\)/g;
const JS_FILTERS = [
  "jQuery",
  "document",
  "getContext",
  "toDataURL",
  "getImageData",
  "width",
  "height",
];

interface MangaGoMetadata {
  page?: number;
}

class MangaGoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // The site gates some content behind an "adult confirmed" cookie.
    request.cookies = {
      ...request.cookies,
      _m_superu: "1",
    };

    // Image hosts that contain an underscore only serve plain HTTP.
    let url = request.url;
    try {
      const host = url.replace(/^https?:\/\//, "").split("/")[0];
      if (host.includes("_") && url.startsWith("https://")) {
        url = "http://" + url.slice("https://".length);
        request.url = url;
      }
    } catch {
      // ignore
    }

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

    // Scrambled images carry their descrambling key in the URL fragment.
    const fragment = request.url.split("#")[1] ?? "";
    if (fragment.includes("desckey=")) {
      try {
        return await descrambleImage(request.url, data);
      } catch {
        // If descrambling fails, return the original bytes so the reader
        // at least shows the scrambled page rather than nothing.
        return data;
      }
    }

    return data;
  }
}

type MangaGoImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MangaGoExtension implements MangaGoImplementation {
  requestManager = new MangaGoInterceptor("main");
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

    // Seed the adult-confirmation cookie.
    this.cookieStorageInterceptor.setCookie({
      name: "_m_superu",
      value: "1",
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
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MangaGoMetadata | undefined;
    const page = meta?.page ?? 1;

    const sortby = section.id === "latest" ? "update_date" : "view";
    const url = `${BASE_URL}/genre/all/${page}/?f=1&o=1&sortby=${sortby}&e=`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    $(".updatesli").each((_, element) => {
      const parsed = this.mangaFromElement($, $(element));
      if (parsed) {
        items.push({
          type:
            section.id === "popular"
              ? "featuredCarouselItem"
              : "simpleCarouselItem",
          mangaId: parsed.mangaId,
          imageUrl: parsed.image,
          title: parsed.title,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = $(".current+li > a").length > 0;

    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MangaGoMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery) {
      url = `${BASE_URL}/r/l_search?name=${encodeURIComponent(titleQuery)}&page=${page}`;
    } else {
      url = `${BASE_URL}/genre/all/${page}/?f=1&o=1&sortby=view&e=`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    $(".updatesli, .pic_list > li").each((_, element) => {
      const parsed = this.mangaFromElement($, $(element));
      if (parsed) {
        results.push({
          mangaId: parsed.mangaId,
          imageUrl: parsed.image,
          title: parsed.title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = $(".current+li > a").length > 0;

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private mangaFromElement(
    $: CheerioAPI,
    element: Cheerio<Element>,
  ): { mangaId: string; title: string; image: string } | undefined {
    const link = element.find(".thm-effect").first();
    if (link.length === 0) return undefined;

    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parseMangaId(href);

    const title = (link.attr("title") || "").trim();
    if (!title) return undefined;

    const image = this.imageFromElement(link.find("img").first());

    return { mangaId, title, image };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $(".w-title h1").first().text().trim();

    const info = $("#information");
    const image = this.imageFromElement(info.find("img").first());

    const summary = info.find(".manga_summary").first().clone();
    summary.find("font").remove();
    let description = summary.text().trim();

    let author = "";
    let status = "Unknown";
    const genres: string[] = [];

    info.find(".manga_info li, .manga_right tr").each((_, el) => {
      const row = $(el);
      const label = row.find("b, label").first().text().trim().toLowerCase();

      if (label.startsWith("alternative")) {
        const alt = row.text().replace(/alternative:?/i, "").trim();
        if (alt) description = `${description}\n\n${alt}`.trim();
      } else if (label.startsWith("status")) {
        const s = row.find("span").first().text().trim().toLowerCase();
        if (s.includes("ongoing")) status = "Ongoing";
        else if (s.includes("completed")) status = "Completed";
      } else if (label.startsWith("author")) {
        author = row
          .find("a")
          .map((_i, a) => $(a).text().trim())
          .get()
          .filter((x) => x)
          .join(", ");
      } else if (label.startsWith("genre")) {
        row.find("a").each((_i, a) => {
          const g = $(a).text().trim();
          if (g) genres.push(g);
        });
      }
    });

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
        thumbnailUrl: image,
        author: author || undefined,
        synopsis: description,
        contentRating: ContentRating.MATURE,
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
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $(
      "table#chapter_table > tbody > tr, table.uk-table > tbody > tr",
    ).each((_, element) => {
      const row = $(element);
      const link = row.find("a.chico").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterId = this.parseChapterId(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = link.text().trim();
      const dateText = row.find("td:last-child").text().trim();
      const chapNum = this.parseChapterNumber(name, chapterId);

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum,
        publishDate: this.parseDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages = await this.getChapterImageUrls($);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // ----------------------------------------------------------------
  // Page image pipeline (the hard part)
  // ----------------------------------------------------------------

  private async getChapterImageUrls($: CheerioAPI): Promise<string[]> {
    // 1. Extract the base64 `imgsrcs` blob from the inline script.
    let imgSrcsB64 = "";
    $("script").each((_, el) => {
      if (imgSrcsB64) return;
      const content = $(el).html() || "";
      const match = content.match(IMG_SRCS_REGEX);
      if (match) imgSrcsB64 = match[1];
    });
    if (!imgSrcsB64) return [];

    const encryptedBytes = this.base64ToBytes(imgSrcsB64);

    // 2. Fetch and deobfuscate chapter.js (sojson.v4).
    const chapterJsHref = $("script[src*=chapter.js]").first().attr("src");
    if (!chapterJsHref) return [];
    const chapterJsUrl = this.absoluteUrl(chapterJsHref);

    const [jsResponse, jsData] = await Application.scheduleRequest({
      url: chapterJsUrl,
      method: "GET",
    });
    if (jsResponse.status !== 200) return [];
    const obfuscated = Application.arrayBufferToUTF8String(jsData);
    const chapterJs = this.sojsonV4Decode(obfuscated);

    // 3. AES-CBC decrypt the imgsrcs blob with key/iv from chapter.js.
    const keyHex = this.findHexEncodedVariable(chapterJs, "key");
    const ivHex = this.findHexEncodedVariable(chapterJs, "iv");
    if (!keyHex || !ivHex) return [];

    const decrypted = await aesCbcDecryptNoPad(
      encryptedBytes,
      this.hexToBytes(keyHex),
      this.hexToBytes(ivHex),
    );
    let imageList = bytesToUtf8(decrypted);

    // 4. Unscramble the (possibly scrambled) image list.
    imageList = this.unscrambleImageList(imageList, chapterJs);

    // 5. Number of grid columns for scrambled images.
    const colsMatch = chapterJs.match(COLS_REGEX);
    const cols = colsMatch ? colsMatch[1] : "0";

    // 6. Extract the descrambling-key generator body.
    const imgKeys = this.extractImgKeys(chapterJs);

    const urls = imageList.split(",").filter((u) => u);

    // 7. Resolve descrambling keys for scrambled (cspiclink) images.
    const cspiclinkUrls = urls.filter((u) => u.includes("cspiclink"));
    let keyByUrl: Record<string, string> = {};
    if (cspiclinkUrls.length > 0 && imgKeys) {
      keyByUrl = await this.resolveDescramblingKeys(cspiclinkUrls, imgKeys);
    }

    return urls.map((url) => {
      if (url.includes("cspiclink")) {
        const descKey = keyByUrl[url];
        if (descKey) {
          return `${url}#desckey=${descKey}&cols=${cols}`;
        }
      }
      return url;
    });
  }

  private async resolveDescramblingKeys(
    urls: string[],
    imgKeys: string,
  ): Promise<Record<string, string>> {
    const inject = `
function replacePos(strObj, pos, replacetext){return strObj.substr(0,pos)+replacetext+strObj.substring(pos+1,strObj.length);}
function getDescramblingKey(url){ ${imgKeys}; return key; }
JSON.stringify(${JSON.stringify(urls)}.map(function(u){
  try { return { url: u, key: String(getDescramblingKey(u)) }; }
  catch (e) { return { url: u, key: "" }; }
}));
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

    const map: Record<string, string> = {};
    try {
      const parsed = JSON.parse(String(result.result)) as {
        url: string;
        key: string;
      }[];
      for (const entry of parsed) {
        if (entry.key) map[entry.url] = entry.key;
      }
    } catch {
      // ignore parse failures
    }
    return map;
  }

  // sojson.v4 deobfuscator (port of SoJsonV4Deobfuscator.kt).
  private sojsonV4Decode(jsf: string): string {
    if (!jsf.startsWith("['sojson.v4']")) {
      throw new Error("Unexpected chapter.js format");
    }
    const slice = jsf.substring(240, jsf.length - 59);
    const tokens = slice.split(/[a-zA-Z]+/);
    let out = "";
    for (const token of tokens) {
      if (!token) continue;
      const code = parseInt(token, 10);
      if (!isNaN(code)) out += String.fromCharCode(code);
    }
    return out;
  }

  private findHexEncodedVariable(js: string, name: string): string {
    const regex = new RegExp(
      `var ${name}\\s*=\\s*CryptoJS\\.enc\\.Hex\\.parse\\("([0-9a-zA-Z]+)"\\)`,
    );
    const match = js.match(regex);
    return match ? match[1] : "";
  }

  private unscrambleImageList(imageList: string, chapterJs: string): string {
    const matches = [...chapterJs.matchAll(KEY_LOCATION_REGEX)].map((m) =>
      parseInt(m[1], 10),
    );
    const keyLocations = [...new Set(matches)];
    if (keyLocations.length === 0) return imageList;

    const unscrambleKey = keyLocations.map((loc) =>
      parseInt(imageList.charAt(loc), 10),
    );
    // A non-numeric character at a key location means the list was never
    // scrambled in the first place.
    if (unscrambleKey.some((n) => isNaN(n))) return imageList;

    const chars = imageList.split("");
    keyLocations.forEach((loc, idx) => {
      chars.splice(loc - idx, 1);
    });

    return this.unscramble(chars.join(""), unscrambleKey);
  }

  private unscramble(str: string, keys: number[]): string {
    const s = str.split("");
    [...keys].reverse().forEach((key) => {
      for (let i = s.length - 1; i >= key; i--) {
        if (i % 2 !== 0) {
          const tmp = s[i - key];
          s[i - key] = s[i];
          s[i] = tmp;
        }
      }
    });
    return s.join("");
  }

  private extractImgKeys(chapterJs: string): string {
    const afterMarker = chapterJs.split(
      "var renImg = function(img,width,height,id){",
    )[1];
    if (!afterMarker) return "";
    const body = afterMarker.split("key = key.split(")[0];
    if (!body) return "";
    return body
      .split("\n")
      .filter((line) => JS_FILTERS.every((f) => !line.includes(f)))
      .join("\n")
      .replace(/img\.src/g, "url");
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    return slug.startsWith("http") ? slug : `${BASE_URL}/${slug}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    return slug.startsWith("http") ? slug : `${BASE_URL}/${slug}`;
  }

  private parseMangaId(href: string): string {
    return this.parsePath(href);
  }

  private parseChapterId(href: string): string {
    return this.parsePath(href);
  }

  private parsePath(href: string): string {
    if (href.startsWith("http")) {
      // Keep absolute URLs intact (used directly for requests).
      return this.toSafeId(href);
    }
    const slug = href.replace(/^\/+/, "").replace(/\/+$/, "");
    return this.toSafeId(slug);
  }

  private absoluteUrl(href: string): string {
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("/")) return `${BASE_URL}${href}`;
    return `${BASE_URL}/${href}`;
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

  private parseChapterNumber(name: string, chapterId: string): number {
    const numMatch = name.match(/chapter\s*(\d+(?:\.\d+)?)/i);
    if (numMatch) return parseFloat(numMatch[1]);
    const anyNum = name.match(/(\d+(?:\.\d+)?)/);
    if (anyNum) return parseFloat(anyNum[1]);
    const slugMatch = chapterId.match(/c(\d+(?:\.\d+)?)/i);
    if (slugMatch) return parseFloat(slugMatch[1]);
    return 0;
  }

  private base64ToBytes(value: string): Uint8Array {
    const decoded = Application.base64Decode(value);
    if (typeof decoded === "string") {
      const out = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
      return out;
    }
    return new Uint8Array(decoded);
  }

  private hexToBytes(hex: string): Uint8Array {
    const clean = hex.length % 2 === 0 ? hex : "0" + hex;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }

  private imageFromElement(img: Cheerio<Element>): string {
    if (!img || img.length === 0) return "";
    let src = img.attr("data-cfsrc") || img.attr("data-src") || "";
    if (!src) {
      const srcset = img.attr("srcset");
      if (srcset) src = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
    }
    if (!src) src = img.attr("src") || "";

    src = src.trim();
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/") ? `${BASE_URL}${src}` : `${BASE_URL}/${src}`;
    }
    return src;
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date(0);
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date(0);
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
}

// --------------------------------------------------------------------
// Crypto + image descrambling (module-level helpers)
// --------------------------------------------------------------------

function bytesToUtf8(bytes: Uint8Array): string {
  return Application.arrayBufferToUTF8String(bufferOf(bytes));
}

// AES-CBC decryption that preserves zero-byte padding semantics.
//
// WebCrypto only supports PKCS7 padding and will reject the site's
// zero-byte-padded ciphertext. We append one synthetic block that decrypts
// to a valid PKCS7 pad block (which WebCrypto then strips), recovering the
// raw plaintext, and finally strip any trailing zero bytes ourselves.
async function aesCbcDecryptNoPad(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto: { subtle: SubtleLike } }).crypto
    .subtle;

  const cryptoKey = await subtle.importKey(
    "raw",
    bufferOf(key),
    { name: "AES-CBC" },
    false,
    ["encrypt", "decrypt"],
  );

  const lastBlock = ciphertext.slice(ciphertext.length - 16);
  const padBlock = new Uint8Array(16);
  for (let i = 0; i < 16; i++) padBlock[i] = 0x10 ^ lastBlock[i];

  const zeroIv = new Uint8Array(16);
  const encrypted = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-CBC", iv: bufferOf(zeroIv) },
      cryptoKey,
      bufferOf(padBlock),
    ),
  );
  const syntheticBlock = encrypted.slice(0, 16);

  const extended = new Uint8Array(ciphertext.length + 16);
  extended.set(ciphertext, 0);
  extended.set(syntheticBlock, ciphertext.length);

  const decrypted = new Uint8Array(
    await subtle.decrypt(
      { name: "AES-CBC", iv: bufferOf(iv) },
      cryptoKey,
      bufferOf(extended),
    ),
  );

  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0) end--;
  return decrypted.slice(0, end);
}

// Descramble a cols x cols grid-shuffled image inside a webview canvas.
async function descrambleImage(
  url: string,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  const fragment = url.split("#")[1] ?? "";
  const params = new Map<string, string>();
  for (const part of fragment.split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const key = params.get("desckey") || "";
  const cols = parseInt(params.get("cols") || "0", 10);
  if (!key || !cols || cols <= 0) return data;

  const b64 = Application.base64Encode(data);
  const b64Str = typeof b64 === "string" ? b64 : Application.arrayBufferToUTF8String(b64);
  const dataUrl = `data:image/jpeg;base64,${b64Str}`;

  const inject = `
(function(){
  return new Promise(function(resolve){
    var img = new Image();
    img.onload = function(){
      try {
        var cols = ${cols};
        var w = img.naturalWidth, h = img.naturalHeight;
        var uw = Math.floor(w / cols), uh = Math.floor(h / cols);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        var keyArr = ${JSON.stringify(key)}.split('a');
        for (var idx = 0; idx < cols * cols; idx++) {
          var keyval = parseInt(keyArr[idx] || '0', 10);
          if (isNaN(keyval)) keyval = 0;
          var hy = Math.floor(keyval / cols);
          var dy = hy * uh;
          var dx = (keyval - hy * cols) * uw;
          var wy = Math.floor(idx / cols);
          var sy = wy * uh;
          var sx = (idx - wy * cols) * uw;
          ctx.drawImage(img, sx, sy, uw, uh, dx, dy, uw, uh);
        }
        resolve(canvas.toDataURL('image/jpeg', 1.0));
      } catch (e) {
        resolve('');
      }
    };
    img.onerror = function(){ resolve(''); };
    img.src = ${JSON.stringify(dataUrl)};
  });
})()
`;

  const result = await Application.executeInWebView({
    source: {
      html: "<html><head></head><body></body></html>",
      baseUrl: BASE_URL,
      loadCSS: false,
      loadImages: true,
    },
    inject,
    storage: { cookies: [] },
  });

  const resultUrl = String(result.result || "");
  const commaIdx = resultUrl.indexOf(",");
  if (!resultUrl.startsWith("data:") || commaIdx < 0) return data;

  const payload = resultUrl.slice(commaIdx + 1);
  const decoded = Application.base64Decode(payload);
  if (typeof decoded === "string") {
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out.buffer;
  }
  return decoded;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

// Minimal structural type for the WebCrypto subtle API used above.
interface SubtleLike {
  importKey(
    format: string,
    keyData: ArrayBuffer,
    algorithm: { name: string },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  encrypt(
    algorithm: { name: string; iv: ArrayBuffer },
    key: unknown,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: { name: string; iv: ArrayBuffer },
    key: unknown,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
}

export const MangaGo = new MangaGoExtension();
