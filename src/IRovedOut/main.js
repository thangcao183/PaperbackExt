import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.irovedout.com";
const ARCHIVE_URL = `${BASE_URL}/archive`;
const MANGA_ID = "archive";
const TITLE = "I Roved Out in Search of Truth and Love";
const AUTHOR = "Alexis Flower";
const GENRE = "Fantasy";
const THUMBNAIL = "https://i.ibb.co/2g7Htwq/irovedout.png";
const DESCRIPTION = "I ROVED OUT IN SEARCH OF TRUTH AND LOVE is written & illustrated by Alexis Flower.\nIt updates in chunks anywhere between 3 and 30 pages long at least once a month.";
// "Book 1: Chapter Title"
const TITLE_REGEX = /^Book (\d+): (.+)$/;
// Matches dates like "January 02, 2020"
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
class IRovedOutInterceptor extends PaperbackInterceptor {
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
export class IRovedOutExtension {
    requestManager = new IRovedOutInterceptor("main");
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
                title: "I Roved Out",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = [
            {
                type: "featuredCarouselItem",
                mangaId: MANGA_ID,
                imageUrl: THUMBNAIL,
                title: TITLE,
                metadata: undefined,
            },
        ];
        return { items, metadata: undefined };
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
        const tagGroups = [
            {
                id: "genres",
                title: "Genres",
                tags: [{ id: GENRE.toLowerCase(), title: GENRE }],
            },
        ];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: TITLE,
                secondaryTitles: [],
                thumbnailUrl: THUMBNAIL,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: DESCRIPTION,
                contentRating: ContentRating.MATURE,
                status: "Ongoing",
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const main$ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
        const bookUrls = [];
        main$(`#menu-menu > li > a[href^="${ARCHIVE_URL}"]`).each((_, element) => {
            const href = main$(element).attr("href") || "";
            if (href)
                bookUrls.push(this.absoluteUrl(href));
        });
        const chapters = [];
        const seen = new Set();
        for (let bookIndex = 0; bookIndex < bookUrls.length; bookIndex++) {
            const bookNumber = bookIndex + 1;
            const book$ = await this.fetchCheerio({
                url: bookUrls[bookIndex],
                method: "GET",
            });
            book$(".comic-archive-chapter-wrap").each((_, element) => {
                const wrap = book$(element);
                const chapterName = wrap
                    .find(".comic-archive-chapter")
                    .first()
                    .text()
                    .trim();
                const href = wrap.find(".comic-archive-title > a").first().attr("href");
                if (!href)
                    return;
                const chapterId = this.parsePath(href);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const dateText = wrap.find(".comic-archive-date").last().text().trim();
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: `Book ${bookNumber}: ${chapterName}`,
                    volume: bookNumber,
                    chapNum: 0,
                    publishDate: this.parseDate(dateText),
                    langCode: "🇬🇧",
                });
            });
        }
        // Upstream presents newest first; number them ascending then reverse.
        chapters.forEach((chapter, index) => {
            chapter.chapNum = index + 1;
        });
        chapters.reverse();
        return chapters;
    }
    async getChapterDetails(chapter) {
        const pages = [];
        const match = TITLE_REGEX.exec(chapter.title ?? "");
        if (match) {
            const bookNumber = parseInt(match[1], 10);
            const chapterTitle = match[2];
            const archiveUrl = bookNumber !== 1 ? `${ARCHIVE_URL}-book-${bookNumber}` : ARCHIVE_URL;
            const book$ = await this.fetchCheerio({ url: archiveUrl, method: "GET" });
            const wraps = book$(".comic-archive-chapter-wrap").toArray();
            const target = wraps.find((el) => book$(el).find(".comic-archive-chapter").first().text().trim() ===
                chapterTitle);
            const pageUrls = [];
            if (target) {
                book$(target)
                    .find(".comic-archive-list-wrap .comic-archive-title > a")
                    .each((_, element) => {
                    const href = book$(element).attr("href") || "";
                    if (href)
                        pageUrls.push(this.absoluteUrl(href));
                });
            }
            for (const pageUrl of pageUrls) {
                const comic$ = await this.fetchCheerio({ url: pageUrl, method: "GET" });
                const src = comic$("#comic img").first().attr("src") || "";
                if (src)
                    pages.push(this.absoluteUrl(src));
            }
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
    parsePath(href) {
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
    parseDate(text) {
        const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text || "");
        if (!m)
            return new Date(0);
        const month = MONTHS[m[1].toLowerCase()];
        if (month === undefined)
            return new Date(0);
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        return new Date(year, month, day);
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
export const IRovedOut = new IRovedOutExtension();
