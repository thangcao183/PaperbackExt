import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { MangaHereSearchForm } from "./forms";
const BASE_URL = "https://www.mangahere.cc";
class MangaHereInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        // Age gate cookie for adult content.
        request.cookies = { ...request.cookies, isAdult: "1" };
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
        return data;
    }
}
export class MangaHereExtension {
    requestManager = new MangaHereInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 1,
        bufferInterval: 2,
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
    async getAdvancedSearchForm(query) {
        const meta = query.metadata;
        return new MangaHereSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const url = section.id === "latest"
            ? `${BASE_URL}/directory/${page}.htm?latest`
            : `${BASE_URL}/directory/${page}.htm`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        $(".manga-list-1-list li").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            const title = (link.attr("title") || link.text()).trim();
            if (!href || !title)
                return;
            const imageUrl = this.absoluteUrl(el.find("img.manga-list-1-cover").first().attr("src") || "");
            items.push({
                type: section.id === "latest"
                    ? "simpleCarouselItem"
                    : "featuredCarouselItem",
                mangaId: this.parsePath(href),
                imageUrl,
                title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("div.pager-list-left a:last-child").length > 0;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const url = this.buildSearchUrl(titleQuery, searchMeta, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $(".manga-list-4-list > li").each((_, element) => {
            const el = $(element);
            const link = el.find(".manga-list-4-item-title > a").first();
            const href = link.attr("href") || "";
            const title = (link.attr("title") || link.text()).trim();
            if (!href || !title)
                return;
            const imageUrl = this.absoluteUrl(el.find("img.manga-list-4-cover").first().attr("src") || "");
            results.push({
                mangaId: this.parsePath(href),
                imageUrl,
                title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("div.pager-list-left a:last-child").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    buildSearchUrl(titleQuery, searchMeta, page) {
        let url = `${BASE_URL}/search?page=${page}&title=${encodeURIComponent(titleQuery)}&stype=1`;
        if (searchMeta) {
            const type = searchMeta.type?.[0];
            if (type)
                url += `&type=${type}`;
            const completion = searchMeta.completion?.[0];
            if (completion)
                url += `&st=${completion}`;
            const rating = searchMeta.rating?.[0];
            if (rating)
                url += `&rating_method=gt&rating=${rating}`;
            const include = searchMeta.includeGenres ?? [];
            if (include.length > 0)
                url += `&genres=${include.join(",")}`;
            const exclude = searchMeta.excludeGenres ?? [];
            if (exclude.length > 0)
                url += `&nogenres=${exclude.join(",")}`;
            if (searchMeta.artist)
                url += `&artist_method=cw&artist=${encodeURIComponent(searchMeta.artist)}`;
            if (searchMeta.author)
                url += `&author_method=cw&author=${encodeURIComponent(searchMeta.author)}`;
            if (searchMeta.year)
                url += `&released_method=eq&released=${encodeURIComponent(searchMeta.year)}`;
        }
        return url;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $(".detail-info-right-title-font").first().text().trim() ||
            this.safeDecode(mangaId);
        const thumbnailUrl = this.absoluteUrl($("img.detail-info-cover-img").first().attr("src") || "");
        const synopsis = $(".fullcontent").first().text().trim();
        const author = $(".detail-info-right-say > a").first().text().trim();
        const statusText = $("span.detail-info-right-title-tip").first().text().trim();
        const genres = $(".detail-info-right-tag-list > a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const tagGroups = [];
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
                thumbnailUrl,
                author: author || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(statusText),
                tagGroups,
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
        $("ul.detail-main-list > li").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const name = link.find("p.title3").first().text().trim();
            const dateText = link.find("p.title2").first().text().trim();
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
                publishDate: this.parseChapterDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const html = Application.arrayBufferToUTF8String(data);
        const $ = cheerio.load(htmlparser2.parseDocument(html));
        let pages = [];
        // Case A: webtoon reader (chapter_bar script + packed newImgs array).
        const hasWebtoon = $("script[src*=chapter_bar]").length > 0;
        if (hasWebtoon) {
            const packed = this.findPackedScript($);
            if (packed) {
                const deobfuscated = this.unpack(packed);
                const slice = deobfuscated
                    .split("newImgs=['")[1]
                    ?.split("'];")[0];
                if (slice) {
                    pages = slice
                        .split("','")
                        .map((s) => (s.startsWith("http") ? s : `https:${s}`))
                        .filter((s) => s.length > 0);
                }
            }
        }
        // Case B: page-by-page chapterfun.ashx flow.
        if (pages.length === 0) {
            pages = await this.fetchPagesByKey($, html, url);
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
    // Page decryption helpers (Dean-Edwards unpack + chapterfun.ashx)
    // ----------------------------------------------------------------
    findPackedScript($) {
        let found;
        $("script").each((_, el) => {
            if (found)
                return;
            const text = $(el).html() || "";
            if (text.includes("function(p,a,c,k,e,d)") && text.includes("newImgs")) {
                found = text.replace(/^\s*eval/, "");
            }
        });
        if (found)
            return found;
        // Fallback: any packed script.
        $("script").each((_, el) => {
            if (found)
                return;
            const text = $(el).html() || "";
            if (text.includes("function(p,a,c,k,e,d)")) {
                found = text.replace(/^\s*eval/, "");
            }
        });
        return found;
    }
    // Dean-Edwards p,a,c,k,e,d unpacker (pure, deterministic, no eval).
    unpack(packed) {
        const argsMatch = packed.match(/\}\s*\(\s*'([\s\S]*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\s*\.split\(\s*'\|'\s*\)/);
        if (!argsMatch)
            return packed;
        let payload = argsMatch[1];
        const radix = parseInt(argsMatch[2], 10);
        const count = parseInt(argsMatch[3], 10);
        const keywords = argsMatch[4].split("|");
        payload = payload
            .replace(/\\\\/g, "\\")
            .replace(/\\'/g, "'")
            .replace(/\\n/g, "\n");
        const encode = (n) => {
            const prefix = n < radix ? "" : encode(Math.floor(n / radix));
            const rem = n % radix;
            const ch = rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36);
            return prefix + ch;
        };
        for (let i = count - 1; i >= 0; i--) {
            const word = keywords[i];
            if (word) {
                const token = encode(i);
                payload = payload.replace(new RegExp("\\b" + this.escapeRegex(token) + "\\b", "g"), word);
            }
        }
        return payload;
    }
    escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    async fetchPagesByKey($, html, chapterUrl) {
        const pages = [];
        // Extract chapterId from the inline "var chapterid =...;"
        const cidStart = html.indexOf("chapterid");
        if (cidStart < 0)
            return pages;
        const cidEnd = html.indexOf(";", cidStart);
        const chapterId = html
            .substring(cidStart + 11, cidEnd)
            .replace(/[^0-9]/g, "")
            .trim();
        if (!chapterId)
            return pages;
        // Page count from the bottom pager.
        const pagerLinks = $(".pager-list-left > span").first().find("a");
        const total = pagerLinks.length;
        if (total < 2)
            return pages;
        const pagesNumber = parseInt($(pagerLinks[total - 2]).attr("data-page") || "0", 10);
        if (!pagesNumber)
            return pages;
        const secretKey = await this.extractSecretKey(html, chapterUrl);
        const pageBase = chapterUrl.substring(0, chapterUrl.lastIndexOf("/"));
        let key = secretKey;
        for (let i = 1; i <= pagesNumber; i++) {
            const ashx = `${pageBase}/chapterfun.ashx?cid=${chapterId}&page=${i}&key=${key}`;
            let responseText = "";
            for (let attempt = 0; attempt < 3; attempt++) {
                const [resp, respData] = await Application.scheduleRequest({
                    url: ashx,
                    method: "GET",
                    headers: {
                        referer: chapterUrl,
                        accept: "*/*",
                        "x-requested-with": "XMLHttpRequest",
                    },
                });
                if (resp.status === 404)
                    break;
                responseText = Application.arrayBufferToUTF8String(respData).trim();
                if (responseText)
                    break;
                key = "";
            }
            if (!responseText)
                continue;
            const deobf = this.unpack(responseText.replace(/^\s*eval/, ""));
            const baseLink = this.between(deobf, "pix=", ";").replace(/['"]/g, "");
            const imageLink = this.between(deobf, 'pvalue=["', '"]')
                .split('","')[0]
                .replace(/['"\\]/g, "");
            if (baseLink && imageLink) {
                pages.push(`https:${baseLink}${imageLink}`);
            }
        }
        return pages;
    }
    async extractSecretKey(html, chapterUrl) {
        const start = html.indexOf("eval(function(p,a,c,k,e,d)");
        if (start < 0)
            return "";
        const end = html.indexOf("</script>", start);
        if (end < 0)
            return "";
        const script = html.substring(start, end).replace(/^\s*eval/, "");
        const deobf = this.unpack(script);
        const keyStart = deobf.indexOf("'");
        if (keyStart < 0)
            return "";
        const keyEnd = deobf.indexOf(";", keyStart);
        if (keyEnd < 0)
            return "";
        const keyExpr = deobf.substring(keyStart, keyEnd);
        // The key expression is JS; evaluate it in a webview (on-device only).
        try {
            const result = await Application.executeInWebView({
                source: {
                    html: "<html><head></head><body></body></html>",
                    baseUrl: chapterUrl,
                    loadCSS: false,
                    loadImages: false,
                },
                inject: `JSON.stringify(String(${keyExpr}))`,
                storage: { cookies: [] },
            });
            return JSON.parse(String(result.result));
        }
        catch {
            return "";
        }
    }
    between(source, startToken, endToken) {
        const i = source.indexOf(startToken);
        if (i < 0)
            return "";
        const from = i + startToken.length;
        const j = source.indexOf(endToken, from);
        if (j < 0)
            return "";
        return source.substring(from, j);
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
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
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
        const match = name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : -1;
    }
    absoluteUrl(src) {
        let s = (src || "").trim();
        if (!s)
            return "";
        if (s.startsWith("//"))
            return `https:${s}`;
        if (s.startsWith("http"))
            return s;
        return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
    }
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        return "Unknown";
    }
    parseChapterDate(dateText) {
        if (!dateText)
            return new Date(0);
        const text = dateText.trim();
        const lower = text.toLowerCase();
        const now = new Date();
        if (lower.includes("today") || lower.includes(" ago")) {
            return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
        if (lower.includes("yesterday")) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            d.setDate(d.getDate() - 1);
            return d;
        }
        // Format "MMM dd,yyyy"
        const parsed = new Date(text.replace(",", ", "));
        return isNaN(parsed.getTime()) ? new Date(0) : parsed;
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
export const MangaHere = new MangaHereExtension();
