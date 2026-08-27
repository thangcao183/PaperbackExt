import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://dresdencodak.com";
const MANGA_ID = "category/darkscience/";
const TITLE = "Dark Science";
const AUTHOR = "Sen (A. Senna Diaz)";
const THUMBNAIL = "https://dresdencodak.com/wp-content/uploads/2019/03/DC_CastIcon_Kimiko.png";
const GENRE = "Science Fiction, Mystery, LGBT+";
const DESCRIPTION = `Scientist Kimiko Ross has a problem: her money’s gone and a bank exploded her house. With no place else to go, she travels to Nephilopolis, the city of giants – built from the ruins of an ancient war and a fading memory of tomorrow.
 Follow our cyborg hero as she attempts to survive the bureaucratic behemoth with a little “help” from her “friends.” And what exactly is Dark Science anyway?
Support the comic on Patreon: https://www.patreon.com/dresdencodak`;
const MAX_ARCHIVE_PAGES = 100;
const CHAPTER_NUMBER_REGEX = /Dark Science #(\d+)/;
const CHAPTER_DATE_REGEX = /\/(\d\d\d\d\/\d\d\/\d\d)\//;
class DarkScienceInterceptor extends PaperbackInterceptor {
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
export class DarkScienceExtension {
    requestManager = new DarkScienceInterceptor("main");
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
                title: "Dark Science",
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
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: TITLE,
                secondaryTitles: [],
                thumbnailUrl: THUMBNAIL,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: DESCRIPTION,
                contentRating: ContentRating.EVERYONE,
                status: "Ongoing",
                tagGroups: [
                    {
                        id: "genres",
                        title: "Genres",
                        tags: GENRE.split(",")
                            .map((g) => g.trim())
                            .filter((g) => g.length > 0)
                            .map((g) => ({
                            id: g.toLowerCase().replace(/\s+/g, "-"),
                            title: g,
                        })),
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
        const chapters = [];
        const seen = new Set();
        let chLast = 0;
        let url = this.mangaUrl(sourceManga.mangaId);
        for (let i = 0; i < MAX_ARCHIVE_PAGES && url; i++) {
            const $ = await this.fetchCheerio({ url, method: "GET" });
            const nextUrl = $("#nav-below .nav-previous > a")
                .first()
                .attr("href");
            $("#content article header > h2 > a").each((_index, element) => {
                const el = $(element);
                const chTitle = el.text().trim();
                const chLink = el.attr("href") || "";
                if (!chLink)
                    return;
                const chapterId = this.parsePath(chLink);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const numMatch = chTitle.match(CHAPTER_NUMBER_REGEX);
                const chNum = numMatch ? parseFloat(numMatch[1]) : chLast + 0.01;
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: chTitle,
                    volume: 0,
                    chapNum: chNum,
                    publishDate: this.getDate(chLink),
                    langCode: "🇬🇧",
                });
                chLast = chNum;
            });
            url = nextUrl || undefined;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const src = $("article.post img.aligncenter").first().attr("src") || "";
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
    // Helpers
    // ----------------------------------------------------------------
    getDate(url) {
        const match = url.match(CHAPTER_DATE_REGEX);
        if (!match)
            return new Date(0);
        const parts = match[1].split("/");
        if (parts.length !== 3)
            return new Date(0);
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (isNaN(year) || isNaN(month) || isNaN(day))
            return new Date(0);
        return new Date(Date.UTC(year, month - 1, day));
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
export const DarkScience = new DarkScienceExtension();
