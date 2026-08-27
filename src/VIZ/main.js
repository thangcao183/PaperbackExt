import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
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
// Real server-side search endpoint (added upstream #17409): /search?search=<q>&category=<SEARCH_PATH>.
// SEARCH_PATH pairs with SERVICE_PATH ("shonenjump" -> "SjChapterSeries").
const SEARCH_PATH = "SjChapterSeries";
const SEARCH_URL = `${BASE_URL}/search`;
// Endpoint that returns the (short-lived) signed URL of the scrambled page image.
const IMAGE_URL_ENDPOINT = "get_manga_url";
// EXIF dimension fallbacks taken verbatim from VizImageInterceptor.kt. The
// cell-grid geometry now lives in descrambleViz (shared canvas helper).
const COMMON_WIDTH = 800;
const COMMON_HEIGHT = 1200;
const DATE_REGEX = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const MONTHS = {
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
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/${SERVICE_PATH}`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        return request;
    }
    async interceptResponse(request, response, data) {
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
            if (!imageUrl)
                return data;
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
            const contentType = imgResponse.headers?.["content-type"] ||
                imgResponse.headers?.["Content-Type"] ||
                "image/jpeg";
            const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
            const decoded = await decodeImage(imgData, mimeType);
            return decoded ?? imgData;
        }
        catch {
            // Never throw out of interceptResponse — fall back to the raw JSON
            // body (which the reader will simply fail to render) rather than
            // breaking the whole chapter.
            return data;
        }
    }
}
export class VIZExtension {
    requestManager = new VIZInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 1,
        bufferInterval: 1,
        ignoreImages: true,
    });
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    // ----------------------------------------------------------------
    // Discover sections
    // ----------------------------------------------------------------
    async getDiscoverSections() {
        return [
            {
                id: "free",
                title: "Free Chapters",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const series = await this.fetchSeriesList();
        const items = series.map((s) => ({
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
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim();
        // Upstream #17409 replaced the client-side filter of the free-chapters
        // list with a real server-side search (/search?search=<q>&category=…),
        // which also surfaces non-free titles. Fall back to the free list when the
        // query is empty (nothing to search).
        if (titleQuery === "") {
            const series = await this.fetchSeriesList();
            const items = series.map((s) => ({
                mangaId: s.mangaId,
                imageUrl: s.imageUrl,
                title: s.title,
                subtitle: undefined,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const url = `${SEARCH_URL}?search=${encodeURIComponent(titleQuery)}&category=${SEARCH_PATH}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        const needle = titleQuery.toLowerCase();
        // Search results are laid out as "div.p-cs-tile a.o_property-link".
        $("div.p-cs-tile a.o_property-link").each((_, element) => {
            const item = this.mangaFromElement($(element));
            if (!item || seen.has(item.mangaId))
                return;
            // Upstream filters the returned tiles on the query again because the
            // site's search endpoint also returns loosely related series.
            if (!item.title.toLowerCase().includes(needle))
                return;
            seen.add(item.mangaId);
            results.push({
                mangaId: item.mangaId,
                imageUrl: item.imageUrl,
                title: item.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        return { items: results, metadata: undefined };
    }
    // Shared parser for the redesigned catalog/search tiles (upstream
    // mangaFromElement): title in div.pad-x-rg, thumbnail in
    // div.pos-r img.disp-bl[data-original], link href points at the series page.
    mangaFromElement(el) {
        const href = el.attr("href") || "";
        if (!href)
            return null;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return null;
        const title = el.find("div.pad-x-rg").first().text().trim();
        if (!title)
            return null;
        const imageUrl = this.imageFromElement(el.find("div.pos-r img.disp-bl").first());
        return { mangaId, title, imageUrl };
    }
    async fetchSeriesList() {
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
        const out = [];
        const seen = new Set();
        // Redesigned catalog (upstream #17409) simplified the tile selector.
        $("div.o_sortable > a.o_chapters-link, section.section_chapters div.o_sort_container div.o_sortable > a.o_chapters-link").each((_, element) => {
            const item = this.mangaFromElement($(element));
            if (!item || seen.has(item.mangaId))
                return;
            seen.add(item.mangaId);
            out.push(item);
        });
        out.sort((a, b) => a.title.localeCompare(b.title));
        return out;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const seriesIntro = $("section#series-intro").first();
        const author = (seriesIntro.find("span.disp-bl--bm").first().text().trim() ||
            seriesIntro.find("div.type-rg span").first().text().trim())
            .replace("Created by ", "")
            .trim() || undefined;
        const synopsis = seriesIntro.find("h2 + div").first().text().trim() ||
            seriesIntro.find("div.line-solid").first().text().trim();
        let thumbnailUrl = this.imageFromElement($("meta[property=og:image]"));
        if (!thumbnailUrl) {
            thumbnailUrl = this.imageFromElement($("section.section_chapters td a > img").first());
        }
        if (!thumbnailUrl) {
            thumbnailUrl = this.imageFromElement(seriesIntro.find("img").first());
        }
        const title = seriesIntro.find("h2").first().text().trim() ||
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
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        $("section.section_chapters a.o_chapter-container[id^=ch-]").each((_, element) => {
            const el = $(element);
            const targetUrl = el.attr("data-target-url") || "";
            if (!targetUrl)
                return;
            // Locked chapters use a "javascript:" target and require a paid login,
            // which this standalone doesn't support — skip them.
            if (targetUrl.startsWith("javascript"))
                return;
            const dateTable = el.find("div:nth-child(1) table").first();
            let name;
            let publishDate = new Date(0);
            if (dateTable.length === 0) {
                name = el.text().trim();
            }
            else {
                name =
                    el.find("div:nth-child(2) table td").first().text().trim() ||
                        "Oneshot";
                const dateStr = el
                    .find("div:nth-child(1) table td[align=right], div:nth-child(1) table td > span")
                    .first()
                    .text()
                    .trim();
                publishDate = this.parseDate(dateStr);
            }
            const chapterId = this.parsePath(targetUrl);
            if (!chapterId || seen.has(chapterId))
                return;
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
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        let pageCount = 0;
        $("script").each((_, element) => {
            const data = $(element).html() || "";
            if (data.includes("var pages")) {
                const m = data.match(/var\s+pages\s*=\s*(\d+)/);
                if (m)
                    pageCount = parseInt(m[1], 10);
            }
        });
        const mangaId = url.replace(/[?#].*$/, "").split("/").pop() || "";
        const pages = [];
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
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(mangaId);
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parsePath(href) {
        const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
        const slug = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        return this.toSafeId(slug);
    }
    toSafeId(slug) {
        return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
            const enc = encodeURIComponent(c);
            if (enc !== c)
                return enc;
            return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
        });
    }
    safeDecode(id) {
        try {
            return decodeURIComponent(id);
        }
        catch {
            return id;
        }
    }
    parseChapterNumber(name) {
        const after = name.includes("Ch. ") ? name.split("Ch. ")[1] : name;
        const m = (after || "").match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : -1;
    }
    parseDate(dateStr) {
        const m = (dateStr || "").match(DATE_REGEX);
        if (!m)
            return new Date(0);
        const month = MONTHS[m[1].toLowerCase()];
        if (month === undefined)
            return new Date(0);
        return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
    }
    imageFromElement(img) {
        const src = img.attr("data-original") ||
            img.attr("data-src") ||
            img.attr("src") ||
            img.attr("content") ||
            "";
        return this.absoluteUrl(src);
    }
    absoluteUrl(src) {
        const s = (src || "").trim();
        if (!s)
            return "";
        if (s.startsWith("http"))
            return s;
        if (s.startsWith("//"))
            return `https:${s}`;
        return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
    }
    // ----------------------------------------------------------------
    // Cloudflare + fetch
    // ----------------------------------------------------------------
    async cloudflareBypassCompleted(_request, cookies, _localStorage) {
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            this.cookieStorageInterceptor.deleteCookie(cookie);
        }
        for (const cookie of cookies) {
            if (cookie.expires && cookie.expires.getTime() <= Date.now())
                continue;
            this.cookieStorageInterceptor.setCookie(cookie);
        }
    }
    async fetchCheerio(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
}
// Parse the get_manga_url JSON body and return the first signed image URL.
function parsePageImageUrl(data) {
    const text = Application.arrayBufferToUTF8String(data);
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return "";
    }
    if (typeof parsed !== "object" || parsed === null)
        return "";
    const dataField = parsed.data;
    if (typeof dataField !== "object" || dataField === null)
        return "";
    for (const value of Object.values(dataField)) {
        if (typeof value === "string" && value)
            return value;
    }
    return "";
}
// Read the EXIF SubIFD from a JPEG and extract the ImageUniqueId descramble
// key plus the (real) PixelX/Y dimensions. Mirrors getImageData() in
// VizImageInterceptor.kt. Returns null when no key is present.
function parseExifImageData(data) {
    const bytes = new Uint8Array(data);
    // JPEG must start with SOI (FFD8).
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
        return null;
    // Locate the APP1 (FFE1) segment containing the "Exif\0\0" header.
    let offset = 2;
    let exifStart = -1;
    let exifLength = 0;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff)
            break;
        const marker = bytes[offset + 1];
        // Standalone markers without a length payload.
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (segLen < 2)
            break;
        const segStart = offset + 4;
        if (marker === 0xe1 && segStart + 6 <= bytes.length) {
            // "Exif\0\0"
            if (bytes[segStart] === 0x45 &&
                bytes[segStart + 1] === 0x78 &&
                bytes[segStart + 2] === 0x69 &&
                bytes[segStart + 3] === 0x66 &&
                bytes[segStart + 4] === 0x00 &&
                bytes[segStart + 5] === 0x00) {
                exifStart = segStart + 6;
                exifLength = segLen - 2 - 6;
                break;
            }
        }
        if (marker === 0xda)
            break; // start of scan — no metadata beyond here
        offset = segStart + (segLen - 2);
    }
    if (exifStart < 0 || exifLength <= 8)
        return null;
    // TIFF header (byte order + magic + IFD0 offset).
    const tiff = exifStart;
    let little;
    if (bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49) {
        little = true; // "II"
    }
    else if (bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d) {
        little = false; // "MM"
    }
    else {
        return null;
    }
    const u16 = (p) => little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1];
    const u32 = (p) => (little
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
    const readIfd = (ifdAbs) => {
        const tags = new Map();
        if (ifdAbs + 2 > exifEnd)
            return tags;
        const count = u16(ifdAbs);
        let p = ifdAbs + 2;
        for (let i = 0; i < count; i++) {
            if (p + 12 > exifEnd)
                break;
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
    const typeSize = (type) => {
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
    const dataPointer = (tv) => {
        const total = typeSize(tv.type) * tv.count;
        if (total <= 4)
            return tv.valueOffset;
        return tiff + u32(tv.valueOffset);
    };
    const readNumber = (tv) => {
        const p = dataPointer(tv);
        if (tv.type === 3)
            return u16(p);
        if (tv.type === 4)
            return u32(p);
        return u32(p);
    };
    const readAscii = (tv) => {
        const p = dataPointer(tv);
        let s = "";
        for (let i = 0; i < tv.count; i++) {
            if (p + i >= exifEnd)
                break;
            const c = bytes[p + i];
            if (c === 0)
                break;
            s += String.fromCharCode(c);
        }
        return s;
    };
    const ifd0 = readIfd(tiff + ifd0Offset);
    const exifPtr = ifd0.get(TAG_EXIF_IFD);
    if (!exifPtr)
        return null;
    const exifIfd = readIfd(tiff + readNumber(exifPtr));
    const uniqueTv = exifIfd.get(TAG_UNIQUE_ID);
    if (!uniqueTv)
        return null;
    const uniqueId = readAscii(uniqueTv);
    if (!uniqueId)
        return null;
    const key = uniqueId
        .split(":")
        .map((h) => parseInt(h, 16))
        .filter((n) => !isNaN(n));
    if (key.length === 0)
        return null;
    let width = COMMON_WIDTH;
    let height = COMMON_HEIGHT;
    const wTv = exifIfd.get(TAG_PIXEL_X);
    const hTv = exifIfd.get(TAG_PIXEL_Y);
    if (wTv) {
        const w = readNumber(wTv);
        if (w > 0)
            width = w;
    }
    if (hTv) {
        const h = readNumber(hTv);
        if (h > 0)
            height = h;
    }
    return { width, height, key };
}
// Descramble a VIZ page image using its EXIF key on the polyfilled canvas,
// in-process. Returns null on any failure so the caller can fall back to the
// raw bytes. Geometry is a faithful port of VizImageInterceptor.kt.
async function decodeImage(data, mimeType) {
    const imageData = parseExifImageData(data);
    // No key → the served bytes are already a plain (unscrambled) JPEG.
    if (!imageData)
        return null;
    try {
        return await descrambleViz(data, mimeType, imageData.key, imageData.width, imageData.height);
    }
    catch {
        return null;
    }
}
export const VIZ = new VIZExtension();
