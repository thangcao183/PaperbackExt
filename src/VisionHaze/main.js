import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.visionhaze.com";
const MANGA_ID = "archive/";
const TITLE = "Vision Haze";
const AUTHOR = "Yttrium";
const THUMBNAIL = `${BASE_URL}/_assets/media/banners/banner0.png`;
const DESCRIPTION = "Vision Haze by Yttrium.";
class VisionHazeInterceptor extends PaperbackInterceptor {
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
export class VisionHazeExtension {
    requestManager = new VisionHazeInterceptor("main");
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
                contentRating: ContentRating.EVERYONE,
                status: "Unknown",
                tagGroups: [],
                shareUrl: BASE_URL,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    // The archive is a list of `.archive` chapter headings, each followed by an
    // `.archivepayload` block holding one anchor per page.
    async getChapters(sourceManga) {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/archive/`,
            method: "GET",
        });
        const chapterTitles = $(".archive")
            .map((_, element) => $(element).find("b").text().trim())
            .get();
        const payloads = $(".archivepayload").toArray();
        const entries = [];
        const seen = new Set();
        const pairCount = Math.min(chapterTitles.length, payloads.length);
        for (let i = 0; i < pairCount; i++) {
            const chapterTitle = chapterTitles[i];
            $(payloads[i])
                .find("a")
                .each((_, element) => {
                const anchor = $(element);
                const href = anchor.attr("href") || "";
                if (!href)
                    return;
                const chapterId = this.parsePath(this.absoluteUrl(href));
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const pageNum = anchor.text().trim();
                entries.push({
                    chapterId,
                    title: `Page ${pageNum} - ${chapterTitle}`,
                });
            });
        }
        // Upstream reverses the list so the newest page comes first.
        entries.reverse();
        const total = entries.length;
        return entries.map((entry, index) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.title,
            volume: 0,
            chapNum: total - index,
            publishDate: new Date(0),
            langCode: "🇬🇧",
        }));
    }
    // Pages are served from a predictable path derived from the `?p=` query.
    async getChapterDetails(chapter) {
        const slug = this.safeDecode(chapter.chapterId);
        const match = slug.match(/\?p=(\d+)/);
        const pageNum = match ? Number(match[1]) : Number.NaN;
        const pages = [];
        if (!Number.isNaN(pageNum)) {
            const padded = String(pageNum).padStart(3, "0");
            pages.push(`${BASE_URL}/comic/p${padded}.png`);
        }
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
export const VisionHaze = new VisionHazeExtension();
