import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://mangabolt.com";
// The popular/search listing page has no cover images, so use the site logo
// as a placeholder (Paperback requires a non-empty imageUrl for list items).
const PLACEHOLDER_COVER = "https://imagizer.imageshack.com/img922/7118/ArGMjt.png";
class MangaBoltInterceptor extends PaperbackInterceptor {
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
export class MangaBoltExtension {
    static MAX_CATALOG_PAGES = 10;
    requestManager = new MangaBoltInterceptor("main");
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
    async getDiscoverSectionItems(section, _metadata) {
        if (section.id === "latest") {
            const $ = await this.fetchCheerio({
                url: `${BASE_URL}/latest`,
                method: "GET",
            });
            const items = [];
            const seen = new Set();
            $("div.bg-bg-secondary:has(a[href*=/chapter/])").each((_, element) => {
                const parsed = this.parseLatestItem($, element);
                if (!parsed || seen.has(parsed.mangaId))
                    return;
                seen.add(parsed.mangaId);
                items.push({
                    type: "simpleCarouselItem",
                    mangaId: parsed.mangaId,
                    imageUrl: parsed.imageUrl,
                    title: parsed.title,
                    metadata: undefined,
                });
            });
            return { items, metadata: undefined };
        }
        // popular
        const popular = await this.fetchCatalog(1);
        const items = popular.map((m) => ({
            type: "featuredCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search (client-side filter of the popular list)
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const catalog = await this.fetchCatalog();
        const results = catalog
            .filter((m) => m.title.toLowerCase().includes(titleQuery))
            .map((m) => ({
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items: results, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("#main-content h1").first().text().trim() || this.safeDecode(mangaId);
        const synopsis = $("div.bg-bg-secondary div.px-6 div.flex-col div.text-text-muted")
            .first()
            .text()
            .trim();
        const thumbnailUrl = this.absoluteUrl($("div.flex img").first().attr("src") || "") ||
            PLACEHOLDER_COVER;
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                synopsis,
                contentRating: ContentRating.EVERYONE,
                status: "Unknown",
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
        const elements = $("div.w-full div.bg-bg-secondary:has(div.grid)").toArray();
        elements.forEach((element, index) => {
            const el = $(element);
            const link = el.find("div.grid a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            let name = link.text().trim();
            const secondaryTitle = el.find(".text-xs").first().text().trim();
            if (secondaryTitle &&
                secondaryTitle.toUpperCase() !== "READ" &&
                secondaryTitle.toLowerCase() !== name.toLowerCase()) {
                name += ` - ${secondaryTitle}`;
            }
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name, elements.length - index),
                publishDate: new Date(0),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const seen = new Set();
        $(".js-pages-container img.js-page").each((_, element) => {
            const el = $(element);
            if (el.closest("noscript").length > 0)
                return;
            const raw = el.attr("data-src") || el.attr("src") || "";
            const src = this.absoluteUrl(raw);
            if (!src || src.includes("data:image") || seen.has(src))
                return;
            seen.add(src);
            pages.push(src);
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
    async fetchCatalog(maxPages = MangaBoltExtension.MAX_CATALOG_PAGES) {
        const list = [];
        const seen = new Set();
        let nextUrl = `${BASE_URL}/manga-list/`;
        let pages = 0;
        while (nextUrl && pages < maxPages) {
            pages += 1;
            const $ = await this.fetchCheerio({
                url: nextUrl,
                method: "GET",
            });
            let added = 0;
            $("a.manga-card").each((_, element) => {
                const el = $(element);
                const href = el.attr("href") || "";
                if (!href)
                    return;
                const title = (el.attr("title") ||
                    el.find(".manga-card-title").first().text() ||
                    el.find("img").first().attr("alt") ||
                    "").trim();
                if (!title)
                    return;
                const mangaId = this.parsePath(href);
                if (seen.has(mangaId))
                    return;
                seen.add(mangaId);
                const imageUrl = this.absoluteUrl(el.find("img").first().attr("src") || "") ||
                    PLACEHOLDER_COVER;
                list.push({ mangaId, title, imageUrl });
                added += 1;
            });
            // Follow the "Load Next Page" link; stop when a page adds nothing new.
            const next = $("#js-pagination a[href]").first().attr("href");
            nextUrl = added > 0 && next ? this.absoluteUrl(next) : undefined;
        }
        return list;
    }
    parseLatestItem($, element) {
        const el = $(element);
        const link = el.find("a[href*=/chapter/]").first().attr("href") || "";
        if (!link)
            return undefined;
        const afterChapter = link.split("/chapter/")[1] || "";
        const slug = afterChapter.split("-chapter-")[0] || "";
        if (!slug)
            return undefined;
        const title = el.find(".font-bold").text().split("Chapter")[0]?.trim() || "";
        if (!title)
            return undefined;
        // The latest-updates cards frequently reference dead imgur links that
        // respond with an HTML "removed image" page (200 text/html), which
        // Paperback cannot decode as an image. Use the placeholder here; the real
        // cover is resolved later when the manga details page is opened.
        return {
            mangaId: this.parsePath(`/manga/${slug}/`),
            title,
            imageUrl: PLACEHOLDER_COVER,
        };
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
    parseChapterNumber(name, fallback) {
        const match = name.match(/chapter\s*(\d+(?:\.\d+)?)/i) || name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : fallback;
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
export const MangaBolt = new MangaBoltExtension();
