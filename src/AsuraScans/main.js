import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { AsuraScansSearchForm } from "./forms";
import { AsuraScansSettingsForm, getHidePremium } from "./settings";
const BASE_URL = "https://asurascans.com";
const API_URL = "https://api.asurascans.com/api";
const LIMIT = 20;
class AsuraScansInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.5",
        };
        return request;
    }
    async interceptResponse(request, response, data) {
        if (response.headers?.["cf-mitigated"] === "challenge") {
            throw new CloudflareError({
                url: request.url,
                method: request.method ?? "GET",
                headers: { "user-agent": await Application.getDefaultUserAgent() },
            });
        }
        const fragment = request.url.split("#")[1] ?? "";
        if (fragment.startsWith("%7B") || fragment.startsWith("{")) {
            try {
                return await descrambleImage(fragment, data);
            }
            catch {
                return data;
            }
        }
        return data;
    }
}
class AsuraScansExtension {
    requestManager = new AsuraScansInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
        bufferInterval: 2,
        ignoreImages: true,
    });
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    async getSettingsForm() {
        return new AsuraScansSettingsForm();
    }
    async getDiscoverSections() {
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
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        const sort = section.id === "popular" ? "popular" : "latest";
        const url = `${API_URL}/series?offset=${(page - 1) * LIMIT}&limit=${LIMIT}&sort=${sort}&order=desc`;
        const response = await this.fetchJson(url);
        const list = response.data ?? [];
        const items = [];
        for (const manga of list) {
            const mangaId = this.mangaIdFromDto(manga);
            if (!mangaId || !manga.cover)
                continue;
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId,
                imageUrl: manga.cover,
                title: manga.title ?? "",
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: response.meta?.has_more ? { page: page + 1 } : undefined,
        };
    }
    async getAdvancedSearchForm() {
        return new AsuraScansSearchForm();
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const searchMeta = query.metadata
            ?.searchMeta;
        const titleQuery = query.title.trim();
        let url = `${API_URL}/series?offset=${(page - 1) * LIMIT}&limit=${LIMIT}`;
        if (titleQuery)
            url += `&search=${encodeURIComponent(titleQuery)}`;
        const sort = searchMeta?.sort?.[0] ?? "";
        if (sort)
            url += `&sort=${sort}&order=desc`;
        const status = searchMeta?.status?.[0] ?? "";
        if (status)
            url += `&status=${status}`;
        const type = searchMeta?.type?.[0] ?? "";
        if (type)
            url += `&type=${type}`;
        const genres = searchMeta?.genres ?? [];
        if (genres.length > 0)
            url += `&genres=${genres.join(",")}`;
        const minChapters = (searchMeta?.minChapters ?? "").trim();
        if (minChapters)
            url += `&min_chapters=${encodeURIComponent(minChapters)}`;
        const response = await this.fetchJson(url);
        const list = response.data ?? [];
        const items = [];
        for (const manga of list) {
            const mangaId = this.mangaIdFromDto(manga);
            if (!mangaId || !manga.cover)
                continue;
            items.push({
                mangaId,
                title: manga.title ?? "",
                imageUrl: manga.cover,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: response.meta?.has_more ? { page: page + 1 } : undefined,
        };
    }
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const $ = await this.fetchCheerio(`${BASE_URL}/comics/${slug}`);
        const series = this.extractAstroProp($, "title");
        if (!series)
            throw new Error("Series not found");
        const genres = (series.genres ?? []).map((g) => g.name).filter(Boolean);
        const tagGroups = genres.length > 0
            ? [
                {
                    id: "genres",
                    title: "Genres",
                    tags: genres.map((g) => ({
                        id: g.toLowerCase().replace(/\s+/g, "-"),
                        title: g,
                    })),
                },
            ]
            : [];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title ?? slug,
                secondaryTitles: [],
                thumbnailUrl: series.coverUrl ?? "",
                author: series.author,
                artist: series.artist,
                synopsis: this.buildDescription(series),
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(series.status),
                tagGroups,
                shareUrl: `${BASE_URL}/comics/${slug}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const $ = await this.fetchCheerio(`${BASE_URL}/comics/${slug}`);
        const data = this.extractAstroProp($, "chapters");
        const chapters = data?.chapters ?? [];
        const hidePremium = getHidePremium();
        const result = [];
        for (const chap of chapters) {
            const locked = this.isChapterLocked(chap);
            if (hidePremium && locked)
                continue;
            const numberStr = String(chap.number).replace(/\.0$/, "");
            const lock = locked ? "🔒 " : "";
            const title = chap.title ? ` - ${chap.title}` : "";
            result.push({
                chapterId: `${slug}/chapter/${numberStr}`,
                sourceManga,
                title: `${lock}Chapter ${numberStr}${title}`,
                volume: 0,
                chapNum: chap.number,
                publishDate: this.parseDate(chap.created_at),
                langCode: "🇬🇧",
            });
        }
        return result;
    }
    /**
     * Upstream #18485: a chapter is premium either when the flag says so, or
     * while its early-access window is still in the future. The flag was renamed
     * `is_locked` -> `is_premium`, so both are honoured.
     */
    isChapterLocked(chap) {
        if (chap.is_premium === true || chap.is_locked === true)
            return true;
        const until = chap.early_access_until;
        if (!until)
            return false;
        const t = Date.parse(until);
        return !isNaN(t) && t > Date.now();
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const $ = await this.fetchCheerio(`${BASE_URL}/comics/${decoded}`);
        const data = this.extractAstroProp($, "pages");
        const pageDtos = data?.pages ?? [];
        const pages = [];
        for (const page of pageDtos) {
            if (!page.url)
                continue;
            if (page.tiles && page.tiles.length > 0) {
                const meta = {
                    tiles: page.tiles,
                    tileCols: page.tile_cols ?? 4,
                    tileRows: page.tile_rows ?? 5,
                };
                pages.push(`${page.url}#${encodeURIComponent(JSON.stringify(meta))}`);
            }
            else {
                pages.push(page.url);
            }
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        return `${BASE_URL}/comics/${this.safeDecode(mangaId)}`;
    }
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
    // ---- helpers ----
    mangaIdFromDto(manga) {
        const publicUrl = manga.public_url ?? "";
        const segments = publicUrl.split("/").filter(Boolean);
        const last = segments[segments.length - 1] ?? manga.slug ?? "";
        return this.toSafeId(last);
    }
    extractAstroProp($, key) {
        const prop = $(`[props*=${key}]`).attr("props");
        if (!prop)
            return undefined;
        try {
            const parsed = JSON.parse(prop);
            return unwrapAstro(parsed);
        }
        catch {
            return undefined;
        }
    }
    stripHtml(html) {
        if (!html)
            return "";
        try {
            const dom = htmlparser2.parseDocument(html);
            const $ = cheerio.load(dom);
            return $.root().text().trim();
        }
        catch {
            return html.replace(/<[^>]+>/g, "").trim();
        }
    }
    buildDescription(series) {
        const parts = [];
        const plain = this.stripHtml(series.description ?? "");
        if (plain)
            parts.push(plain);
        if (series.popularityRank != null)
            parts.push(`Rank: #${series.popularityRank}`);
        if (series.rating != null)
            parts.push(`Rating: ${series.rating.toFixed(2)}`);
        const altSource = series.alternativeTitles ?? "";
        const altTitles = (altSource.includes("•") ? altSource.split("•") : altSource.split(","))
            .map((t) => t.trim())
            .filter(Boolean);
        if (altTitles.length > 0) {
            parts.push("Alternative Titles:\n" + altTitles.map((t) => `- ${t}`).join("\n"));
        }
        return parts.join("\n\n");
    }
    parseStatus(status) {
        const s = (status ?? "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("hiatus"))
            return "Hiatus";
        if (s.includes("dropped") || s.includes("axed"))
            return "Cancelled";
        return "Unknown";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        let str = value;
        if (str.includes("."))
            str = str.split(".")[0] + "Z";
        const date = new Date(str);
        return isNaN(date.getTime()) ? new Date(0) : date;
    }
    toSafeId(slug) {
        return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
            const enc = encodeURIComponent(c);
            return enc !== c
                ? enc
                : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
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
    async fetchJson(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
    async fetchCheerio(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404)
            throw new Error("Content not found");
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
}
function unwrapAstro(el) {
    if (Array.isArray(el)) {
        if (el.length === 2 && typeof el[0] !== "object") {
            return unwrapAstro(el[1]);
        }
        return el.map(unwrapAstro);
    }
    if (el && typeof el === "object") {
        const out = {};
        for (const [k, v] of Object.entries(el)) {
            out[k] = unwrapAstro(v);
        }
        return out;
    }
    return el;
}
// Re-arrange a tile-scrambled image inside a webview canvas.
async function descrambleImage(fragment, data) {
    let metaStr = fragment;
    try {
        metaStr = decodeURIComponent(fragment);
    }
    catch {
        /* keep raw */
    }
    const meta = JSON.parse(metaStr);
    if (!meta.tiles || meta.tiles.length === 0)
        return data;
    const b64 = Application.base64Encode(data);
    const b64Str = typeof b64 === "string" ? b64 : Application.arrayBufferToUTF8String(b64);
    const dataUrl = `data:image/jpeg;base64,${b64Str}`;
    const inject = `
(function(){
  return new Promise(function(resolve){
    var img = new Image();
    img.onload = function(){
      try {
        var tiles = ${JSON.stringify(meta.tiles)};
        var cols = ${meta.tileCols};
        var rows = ${meta.tileRows};
        var w = img.naturalWidth, h = img.naturalHeight;
        var tw = Math.floor(w / cols), th = Math.floor(h / rows);
        var canvas = document.createElement('canvas');
        canvas.width = tw * cols; canvas.height = th * rows;
        var ctx = canvas.getContext('2d');
        for (var i = 0; i < tiles.length; i++) {
          var j = tiles[i];
          var srcCol = i % cols, srcRow = Math.floor(i / cols);
          var dstCol = j % cols, dstRow = Math.floor(j / cols);
          ctx.drawImage(img, srcCol*tw, srcRow*th, tw, th, dstCol*tw, dstRow*th, tw, th);
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
    if (!resultUrl.startsWith("data:") || commaIdx < 0)
        return data;
    const payload = resultUrl.slice(commaIdx + 1);
    const decoded = Application.base64Decode(payload);
    if (typeof decoded === "string") {
        const out = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++)
            out[i] = decoded.charCodeAt(i);
        return out.buffer;
    }
    return decoded;
}
export const AsuraScans = new AsuraScansExtension();
