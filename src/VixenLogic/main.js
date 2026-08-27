import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.vixenlogic.com";
const MANGA_ID = "archives/";
const TITLE = "Vixen Logic";
const AUTHOR = "tootaloo and foxboy83";
const THUMBNAIL = `${BASE_URL}/wp-content/uploads/2026/06/VL_Cover_Toocheke.png`;
const DESCRIPTION = "Vixen Logic by tootaloo and foxboy83.";
const MONTHS = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
};
class VixenLogicInterceptor extends PaperbackInterceptor {
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
export class VixenLogicExtension {
    requestManager = new VixenLogicInterceptor("main");
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
                id: "comic",
                title: TITLE,
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        return {
            items: [
                {
                    type: "featuredCarouselItem",
                    mangaId: MANGA_ID,
                    imageUrl: THUMBNAIL,
                    title: TITLE,
                    metadata: undefined,
                },
            ],
            metadata: undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const items = [];
        if (titleQuery === "" || TITLE.toLowerCase().includes(titleQuery)) {
            items.push({
                mangaId: MANGA_ID,
                imageUrl: THUMBNAIL,
                title: TITLE,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: TITLE,
                secondaryTitles: [],
                thumbnailUrl: THUMBNAIL,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: DESCRIPTION,
                contentRating: ContentRating.ADULT,
                status: "Unknown",
                tagGroups: [],
                shareUrl: BASE_URL,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/archives/`,
            method: "GET",
        });
        const entries = [];
        const seen = new Set();
        $(".comic-item").each((_, element) => {
            const item = $(element);
            // The anchor wraps the whole `.comic-item` block.
            const href = item.parent().closest("a").attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(this.absoluteUrl(href));
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const title = item.find(".comic-title").text().trim();
            const dateText = item.find(".comic-post-date").text().trim();
            entries.push({
                chapterId,
                title: title || chapterId,
                date: this.parseDate(dateText),
            });
        });
        // The archive lists newest first; number chapters oldest-to-newest.
        const total = entries.length;
        return entries.map((entry, index) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.title,
            volume: 0,
            chapNum: total - index,
            publishDate: entry.date,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const $ = await this.fetchCheerio({
            url: this.chapterUrl(chapter.chapterId),
            method: "GET",
        });
        const pages = [];
        $("#comic p a img").each((_, element) => {
            const src = $(element).attr("src") || "";
            if (!src)
                return;
            const url = this.absoluteUrl(src);
            if (pages.includes(url))
                return;
            pages.push(url);
        });
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(_mangaId) {
        return BASE_URL;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parsePath(href) {
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/#.*$/, "");
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
    // Archive dates look like `Jul 28, 2026`, with `today`/`yesterday` shortcuts.
    parseDate(value) {
        const text = value.trim().toLowerCase();
        if (!text)
            return new Date(0);
        const startOfDay = (offsetDays) => {
            const now = new Date();
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays));
        };
        if (text === "today")
            return startOfDay(0);
        if (text === "yesterday")
            return startOfDay(1);
        const match = text.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        if (match) {
            const month = MONTHS[match[1].slice(0, 3)];
            if (month !== undefined) {
                return new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
            }
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? new Date(0) : new Date(parsed);
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
export const VixenLogic = new VixenLogicExtension();
