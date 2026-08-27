import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://politeandgood.com";
const MANGA_ID = "comic/archive";
const TITLE = "Broccoli Soup";
const AUTHOR = "Secret Pie";
const THUMBNAIL = "https://politeandgood.com/assets/images/static/Bocki%20(correct%20size).png";
const DESCRIPTION = " Hello there! How is the Weather? This comic is made by me, Secret Pie. I am a pie with legs who draws comics and makes music. I am also an entomologist.";
const CHARACTER_SUMMARY_SLUG = "comic-characters";
class BroccoliSoupInterceptor extends PaperbackInterceptor {
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
export class BroccoliSoupExtension {
    requestManager = new BroccoliSoupInterceptor("main");
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
                status: "Ongoing",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        // The character summary page as a chapter (chapter number 0).
        entries.push({
            chapterId: this.toSafeId(CHARACTER_SUMMARY_SLUG),
            name: "Characters",
            chapNum: 0,
        });
        // Keep track of the last-used index within each "arc" of chapters.
        const arcIndexMap = {};
        $("li.archive-marker").each((_index, groupElement) => {
            const group = $(groupElement);
            const arcTitle = group
                .find(".archive-header .marker-title")
                .first()
                .text()
                .trim();
            group.find("li.archive-page").each((_i, chapterElement) => {
                const chapterEl = $(chapterElement);
                const link = chapterEl.find("a").first();
                if (link.length === 0)
                    return;
                const titleEl = link.find("span.page-title").first();
                if (titleEl.length === 0)
                    return;
                const href = link.attr("href") || "";
                if (!href)
                    return;
                const lastSeg = href.replace(/\/+$/, "").split("/").pop() || "";
                const chapterNumber = /^\d+$/.test(lastSeg)
                    ? parseInt(lastSeg, 10)
                    : NaN;
                // Construct a title from the chapter number, chapter title, arc title,
                // and the chapter index within the current arc.
                // E.g. "98: Apologetics (VOID #43)"
                const parts = [];
                if (!Number.isNaN(chapterNumber))
                    parts.push(`${chapterNumber}:`);
                const pageTitle = titleEl.text().trim();
                if (pageTitle)
                    parts.push(pageTitle);
                if (arcTitle) {
                    const newIndex = 1 + (arcIndexMap[arcTitle] ?? 0);
                    arcIndexMap[arcTitle] = newIndex;
                    parts.push(`(${arcTitle} #${newIndex})`);
                }
                const title = parts.join(" ");
                entries.push({
                    chapterId: this.parsePath(href),
                    name: title,
                    chapNum: Number.isNaN(chapterNumber) ? 0 : chapterNumber,
                });
            });
        });
        // Reverse so the latest chapter is first.
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
        const lastSeg = url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || "";
        const pages = [];
        if (lastSeg === CHARACTER_SUMMARY_SLUG) {
            // The character summary page collects the character figures.
            $("section.static-block").each((_index, sectionElement) => {
                const img = $(sectionElement).find("figure img").first();
                const src = this.imageFromElement(img);
                if (src)
                    pages.push(src);
            });
        }
        else {
            $("#comic img").each((_index, element) => {
                const src = this.imageFromElement($(element));
                if (src)
                    pages.push(src);
            });
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
export const BroccoliSoup = new BroccoliSoupExtension();
