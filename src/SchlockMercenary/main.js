import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.schlockmercenary.com";
const ARCHIVE_URL = "/archives/";
const DEFAULT_THUMBNAIL_URL = "/static/img/logo.b6dacbb8.jpg";
const AUTHOR = "Howard Tayler";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 1000;
class SchlockMercenaryInterceptor extends PaperbackInterceptor {
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
export class SchlockMercenaryExtension {
    requestManager = new SchlockMercenaryInterceptor("main");
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
                id: "books",
                title: "Books",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const books = await this.fetchBooks();
        const items = books.map((book) => ({
            type: "simpleCarouselItem",
            mangaId: book.mangaId,
            imageUrl: book.thumbnailUrl,
            title: book.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const books = await this.fetchBooks();
        const items = books
            .filter((book) => titleQuery === "" || book.title.toLowerCase().includes(titleQuery))
            .map((book) => ({
            mangaId: book.mangaId,
            imageUrl: book.thumbnailUrl,
            title: book.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const books = await this.fetchBooks();
        const target = this.parsePath(this.bookHrefFromId(mangaId));
        const book = books.find((b) => b.mangaId === target);
        const title = book?.title || this.safeDecode(mangaId);
        const thumbnailUrl = book?.thumbnailUrl || `${BASE_URL}${DEFAULT_THUMBNAIL_URL}`;
        const synopsis = book?.description || "";
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis,
                contentRating: ContentRating.EVERYONE,
                // Schlock Mercenary finished as of July 2020
                status: "Completed",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}${ARCHIVE_URL}`,
            method: "GET",
        });
        const title = sourceManga.mangaInfo.primaryTitle;
        const bookEl = this.findBookElement($, title);
        const entries = [];
        if (bookEl) {
            bookEl
                .find("ul.chapters > li:not(ul > li > ul > li) > a")
                .each((_index, element) => {
                const el = $(element);
                const href = el.attr("href") || "";
                if (!href)
                    return;
                entries.push({
                    chapterId: this.parsePath(href),
                    name: el.text().trim(),
                    date: this.parseDate(href.slice(-10)),
                });
            });
        }
        return entries
            .map((entry, index) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.name,
            volume: 0,
            chapNum: index + 1,
            publishDate: entry.date > 0 ? new Date(entry.date) : new Date(0),
            langCode: "🇬🇧",
        }))
            .reverse();
    }
    async getChapterDetails(chapter) {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}${ARCHIVE_URL}`,
            method: "GET",
        });
        const targetHref = this.bookHrefFromId(chapter.chapterId);
        let currentAnchor;
        $("ul.chapters > li:not(ul > li > ul > li) > a").each((_, element) => {
            if (currentAnchor)
                return;
            const el = $(element);
            if (this.parsePath(el.attr("href") || "") === chapter.chapterId) {
                currentAnchor = el;
            }
        });
        if (!currentAnchor) {
            return {
                id: chapter.chapterId,
                mangaId: chapter.sourceManga.mangaId,
                pages: [],
            };
        }
        const start = this.parseDate(targetHref.slice(-10));
        // Determine the next chapter's start date (= this chapter's end).
        const currentLi = currentAnchor.parent();
        let nextHref = currentLi.next().find("a").first().attr("href") || "";
        if (!nextHref) {
            // No sibling chapter: jump to the next book's first chapter.
            const book = currentLi.closest("div.archive-book");
            nextHref =
                book
                    .next()
                    .find("ul.chapters > li:not(ul > li > ul > li) > a")
                    .first()
                    .attr("href") || "";
        }
        let end = start + DAY_MS;
        if (nextHref) {
            const parsed = this.parseDate(nextHref.slice(-10));
            if (parsed > 0)
                end = parsed;
        }
        const pages = await this.collectPagesBetween(start, end);
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
    // Internal data fetching
    // ----------------------------------------------------------------
    async fetchBooks() {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}${ARCHIVE_URL}`,
            method: "GET",
        });
        const books = [];
        $("div.archive-book").each((_, element) => {
            const el = $(element);
            const link = el.find("h4 > a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const thumb = el.find("img").first().attr("src") || "";
            const thumbnailUrl = thumb
                ? this.absoluteUrl(thumb).split("?")[0]
                : `${BASE_URL}${DEFAULT_THUMBNAIL_URL}`;
            books.push({
                mangaId: this.parsePath(href),
                title: link.text().trim(),
                thumbnailUrl,
                description: el.find("p").first().text().trim(),
            });
        });
        return books;
    }
    findBookElement($, title) {
        let match;
        $("div.archive-book").each((_, element) => {
            if (match)
                return;
            const el = $(element);
            const bookTitle = el.find("h4 > a").first().text().trim();
            if (bookTitle === title)
                match = el;
        });
        return match;
    }
    async collectPagesBetween(start, end) {
        const pages = [];
        if (start <= 0)
            return pages;
        let cursor = start;
        let guard = 0;
        while (cursor < end && guard < MAX_DAYS) {
            const day = this.formatDate(cursor);
            const dayPages = await this.getImageUrlsForDay(day);
            for (const src of dayPages)
                pages.push(src);
            cursor += DAY_MS;
            guard++;
        }
        return pages;
    }
    async getImageUrlsForDay(day) {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/${day}`,
            method: "GET",
        });
        const urls = [];
        $(`div#strip-${day} > img`).each((_, element) => {
            const src = $(element).attr("src") || "";
            if (src)
                urls.push(this.absoluteUrl(src));
        });
        return urls;
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
    bookHrefFromId(id) {
        const slug = this.safeDecode(id);
        if (slug.startsWith("http")) {
            return slug.replace(/^https?:\/\/[^/]+/, "");
        }
        return slug.startsWith("/") ? slug : `/${slug}`;
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
    parseDate(value) {
        const m = (value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!m)
            return 0;
        const time = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        return Number.isNaN(time) ? 0 : time;
    }
    formatDate(time) {
        const d = new Date(time);
        const year = d.getUTCFullYear().toString().padStart(4, "0");
        const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
        const day = d.getUTCDate().toString().padStart(2, "0");
        return `${year}-${month}-${day}`;
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
export const SchlockMercenary = new SchlockMercenaryExtension();
