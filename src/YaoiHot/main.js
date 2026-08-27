import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://yaoihot.com";
class YaoiHotInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
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
        return data;
    }
}
export class YaoiHotExtension {
    requestManager = new YaoiHotInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
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
        const meta = metadata;
        const page = meta?.page ?? 1;
        const orderby = section.id === "popular" ? "views" : "modified";
        const url = this.listUrl(orderby, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $(".manga-grid .manga-card").each((_, element) => {
            const parsed = this.itemFromCard($, $(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $(".next.page-numbers").length > 0;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        let url;
        if (titleQuery !== "") {
            const segments = [];
            if (page > 1)
                segments.push(`page/${page}`);
            const params = `s=${encodeURIComponent(titleQuery)}&post_type=manga`;
            const path = segments.length > 0 ? `/${segments.join("/")}` : "";
            url = `${BASE_URL}${path}/?${params}`;
        }
        else {
            // Fallback to popular if the query is empty
            url = this.listUrl("views", page);
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $(".manga-grid .manga-card").each((_, element) => {
            const parsed = this.itemFromCard($, $(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $(".next.page-numbers").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    itemFromCard($, el) {
        const link = el.find(".manga-card-link").first();
        const href = link.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = el.find(".manga-card-title").first().text().trim();
        const imageUrl = this.imageFromElement(el.find(".manga-cover-img").first());
        if (!title)
            return undefined;
        return { mangaId, imageUrl, title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $(".manga-title").first().text().trim() || this.safeDecode(mangaId);
        const authorLine = $(".author-line").first().text().trim();
        const author = authorLine.indexOf("Author:") >= 0
            ? authorLine.split("Author:")[1]?.trim()
            : authorLine || undefined;
        const synopsis = $(".summary-content").first().text().trim();
        const thumbnailUrl = this.imageFromElement($(".manga-cover-img").first());
        const genres = $(".genre-tag")
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
                author: author && author.length > 0 ? author : undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: "Unknown",
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
        const seen = new Set();
        const elements = $(".chapters-list .chapter-item").toArray();
        elements.forEach((element, index) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = el.find(".chapter-title").first().text().trim();
            const dateText = el.find(".chapter-date").first().text().trim();
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name) || elements.length - index,
                publishDate: this.parseRelativeDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $(".reader-page img").each((_, element) => {
            const el = $(element);
            const src = el.attr("src") || el.attr("data-src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
        });
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
    listUrl(orderby, page) {
        const path = page > 1 ? `/manga/page/${page}` : "/manga";
        return `${BASE_URL}${path}/?orderby=${orderby}`;
    }
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
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    imageFromElement(img) {
        const src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            img.attr("data-cfsrc") ||
            img.attr("src") ||
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
    parseRelativeDate(dateStr) {
        const trimmed = (dateStr || "").trim().toLowerCase();
        if (trimmed === "")
            return new Date(0);
        const number = parseInt(trimmed.split(" ")[0] || "", 10);
        if (isNaN(number))
            return new Date(0);
        const now = new Date();
        if (trimmed.includes("year")) {
            now.setFullYear(now.getFullYear() - number);
        }
        else if (trimmed.includes("month")) {
            now.setMonth(now.getMonth() - number);
        }
        else if (trimmed.includes("week")) {
            now.setDate(now.getDate() - number * 7);
        }
        else if (trimmed.includes("day")) {
            now.setDate(now.getDate() - number);
        }
        else if (trimmed.includes("hour")) {
            now.setHours(now.getHours() - number);
        }
        else if (trimmed.includes("min")) {
            now.setMinutes(now.getMinutes() - number);
        }
        else if (trimmed.includes("sec")) {
            now.setSeconds(now.getSeconds() - number);
        }
        else {
            return new Date(0);
        }
        return now;
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
export const YaoiHot = new YaoiHotExtension();
