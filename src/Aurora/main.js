import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://comicaurora.com";
const ARCHIVE_PATH = "archive/";
const NAME = "Aurora";
const AUTHOR = "OSP-Red";
const GENRE = "fantasy";
const MAX_PAGES = 100;
const DESCRIPTION = `Aurora is a fantasy webcomic (updates M/W/F) written and illustrated by Red, better known for her work on the YouTube channel "Overly Sarcastic Productions." It's been in the works for over a decade, and she's finally decided to stop putting it off.

If you'd like to discuss the comic, it now has a subreddit, as well as a dedicated twitter and a tumblr where you can ask questions. There's also a dedicated room on the channel discord for conversations about it!

Find Red's general ramblings on Twitter, alongside her cohost Blue, at OSPYouTube.`;
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
class AuroraInterceptor extends PaperbackInterceptor {
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
export class AuroraExtension {
    requestManager = new AuroraInterceptor("main");
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
                id: "chapters",
                title: "Aurora Chapters",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const entries = await this.fetchChaptersAsMangas();
        const items = entries.map((entry) => ({
            type: "simpleCarouselItem",
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const entries = await this.fetchChaptersAsMangas();
        const items = entries
            .filter((entry) => titleQuery === "" || entry.title.toLowerCase().includes(titleQuery))
            .map((entry) => ({
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const title = await this.titleForManga(mangaId);
        const chapterNr = parseFloat(title.split(" ").slice(-1)[0] ?? "") || 0;
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl: "",
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: DESCRIPTION,
                contentRating: ContentRating.EVERYONE,
                status: await this.statusForChapter(chapterNr),
                tagGroups: [
                    {
                        id: "genres",
                        title: "Genres",
                        tags: [{ id: GENRE, title: GENRE }],
                    },
                ],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        let url = this.mangaUrl(sourceManga.mangaId);
        const entries = [];
        const seen = new Set();
        for (let i = 0; i < MAX_PAGES; i++) {
            const $ = await this.fetchCheerio({ url, method: "GET" });
            $(".post-content").each((_, element) => {
                const el = $(element);
                const href = el.find("a.webcomic-link").attr("href") || "";
                if (!href)
                    return;
                const chapterId = this.parsePath(href);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const title = el.find(".post-title a").text().trim();
                const chapNum = parseFloat(title.split(".").slice(1).join(".")) || 0;
                const dateString = el.find(".post-date").text().trim();
                entries.push({
                    chapterId,
                    name: title,
                    chapNum,
                    date: this.parseDate(dateString),
                });
            });
            const nextPageNavUrl = $(".paginav-next a").first().attr("href") || "";
            if (!nextPageNavUrl)
                break;
            url = this.absoluteUrl(nextPageNavUrl);
        }
        // Upstream reverses the accumulated (newest-first) list.
        entries.reverse();
        return entries.map((entry) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.name,
            volume: 0,
            chapNum: entry.chapNum,
            publishDate: entry.date,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const src = $(".webcomic-media .webcomic-link .attachment-full").first().attr("src") ||
            "";
        if (src)
            pages.push(this.absoluteUrl(src));
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
    // Internal scraping helpers
    // ----------------------------------------------------------------
    async fetchChaptersAsMangas() {
        const url = `${BASE_URL}/${ARCHIVE_PATH}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        const seen = new Set();
        $(".wp-block-image:has(a)").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const mangaId = this.parsePath(href);
            if (!mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            const title = `${NAME} - ${link.text().trim()}`;
            const imageUrl = this.imageFromElement(el.find("img").first());
            entries.push({ mangaId, title, imageUrl });
        });
        return entries;
    }
    async titleForManga(mangaId) {
        const entries = await this.fetchChaptersAsMangas();
        const match = entries.find((entry) => entry.mangaId === mangaId);
        if (match)
            return match.title;
        return `${NAME} - ${this.safeDecode(mangaId)}`;
    }
    async statusForChapter(chapter) {
        const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });
        const postTitle = $(".post-title").first().text().trim();
        const parts = postTitle.split(".");
        const chapterOfNewest = parts.length > 1 ? parseFloat(parts[1]) || 0 : 0;
        return chapter >= chapterOfNewest ? "Unknown" : "Completed";
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
    parseDate(dateString) {
        // Upstream format: "MMMM dd, yyyy" (e.g. "January 05, 2020").
        const m = dateString
            .trim()
            .toLowerCase()
            .match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (!m)
            return new Date(0);
        const month = MONTHS[m[1]];
        if (month === undefined)
            return new Date(0);
        return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
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
export const Aurora = new AuroraExtension();
