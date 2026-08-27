import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://jolleycomics.com";
const MANGA_ID = "TPoH/";
const TITLE = "The Property of Hate";
const AUTHOR = "Sarah Jolley";
const THUMBNAIL = "https://jolleycomics.com/images/Index/tpoh.png";
const DESCRIPTION = "The Property of Hate by Sarah Jolley.";
class ThePropertyOfHateInterceptor extends PaperbackInterceptor {
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
export class ThePropertyOfHateExtension {
    requestManager = new ThePropertyOfHateInterceptor("main");
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
                status: "Unknown",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        // The chapter list always lives at /TPoH/ regardless of the manga entry.
        const url = `${BASE_URL}/TPoH/`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        let addedActiveChapter = false;
        let chapterNum = 1;
        $("select.jumpbox option:not([value=-1])").each((_index, element) => {
            const opt = $(element);
            const style = opt.attr("style") || "";
            const isBold = style.includes("bold");
            if (isBold) {
                const currentChapterNum = chapterNum++;
                const value = opt.attr("value") || "";
                const chapterId = this.parsePath(this.absoluteUrl(value));
                entries.push({
                    chapterId,
                    name: `#${currentChapterNum} - ${opt.text().trim()}`,
                    chapNum: currentChapterNum,
                });
            }
            else if (!addedActiveChapter) {
                const pageText = opt.text();
                const chapterName = pageText.split(" : Page")[0].trim();
                const pageUrl = opt.attr("value") || "";
                // Drop the final path segment to get the active chapter URL.
                const chapterUrl = pageUrl.substring(0, pageUrl.lastIndexOf("/")) + "/";
                const currentChapterNum = chapterNum++;
                const chapterId = this.parsePath(this.absoluteUrl(chapterUrl));
                entries.push({
                    chapterId,
                    name: `#${currentChapterNum} - ${chapterName}`,
                    chapNum: currentChapterNum,
                });
                addedActiveChapter = true;
            }
        });
        entries.reverse();
        return entries.map((entry) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.name,
            volume: 0,
            chapNum: entry.chapNum,
            publishDate: new Date(0),
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        // Page URLs are the non-bold jumpbox options on the chapter page.
        const pageUrls = [];
        $("select.jumpbox option:not([style*=bold]):not([value=-1])").each((_index, element) => {
            const value = $(element).attr("value") || "";
            if (value)
                pageUrls.push(this.absoluteUrl(value));
        });
        // Each page URL must be fetched to extract its single comic image.
        const pages = [];
        for (const pageUrl of pageUrls) {
            const $page = await this.fetchCheerio({ url: pageUrl, method: "GET" });
            const src = $page(".comic_comic > img").first().attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
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
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/[?#].*$/, "");
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
export const ThePropertyOfHate = new ThePropertyOfHateExtension();
