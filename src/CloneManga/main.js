import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://manga.clone-army.org";
class CloneMangaInterceptor extends PaperbackInterceptor {
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
export class CloneMangaExtension {
    requestManager = new CloneMangaInterceptor("main");
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
                id: "all",
                title: "All Comics",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const entries = await this.fetchComicList();
        const items = entries.map((e) => ({
            type: "featuredCarouselItem",
            mangaId: e.mangaId,
            imageUrl: e.imageUrl,
            title: e.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const entries = await this.fetchComicList();
        const items = entries
            .filter((e) => titleQuery === "" || e.title.toLowerCase().includes(titleQuery))
            .map((e) => ({
            mangaId: e.mangaId,
            imageUrl: e.imageUrl,
            title: e.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const entries = await this.fetchComicList();
        const entry = entries.find((e) => e.mangaId === mangaId);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: entry?.title || this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl: entry?.imageUrl || "",
                author: "Dan Kim",
                artist: "Dan Kim",
                synopsis: entry?.description || "",
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
        const seriesPath = this.safeDecode(sourceManga.mangaId);
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const numChapters = this.findNumChapters($);
        const chapters = [];
        for (let i = 1; i <= numChapters; i++) {
            const chapterPath = `${seriesPath}&page=${i}`;
            chapters.push({
                chapterId: this.toSafeId(chapterPath.replace(/^\/+/, "")),
                sourceManga,
                title: `Chapter ${i}`,
                volume: 0,
                chapNum: i,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            });
        }
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const src = $(".subsectionContainer")
            .first()
            .find("img")
            .first()
            .attr("src");
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
    async fetchComicList() {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/viewer_landing.php`,
            method: "GET",
        });
        const entries = [];
        $(".comicPreviewContainer").each((_, element) => {
            const el = $(element);
            const title = el.find("h3").first().text().trim();
            const href = el.find("a").first().attr("href") || "";
            if (!title || !href)
                return;
            const mangaId = this.parsePath(href);
            const description = el.find("h4").first().text().trim();
            let imageUrl = "";
            const style = el.find(".comicPreview").attr("style") || "";
            const startIdx = style.indexOf("site/themes");
            const endIdx = style.indexOf(")", startIdx);
            if (startIdx >= 0 && endIdx > startIdx) {
                imageUrl = `${BASE_URL}/${style.substring(startIdx, endIdx)}`;
            }
            entries.push({ mangaId, title, imageUrl, description });
        });
        return entries;
    }
    findNumChapters($) {
        let max = 0;
        $("script").each((_, element) => {
            const content = $(element).html() || "";
            if (!content.includes("&page=") || !content.includes("&lang="))
                return;
            const matches = content.matchAll(/&page=(\d+)&lang=/g);
            for (const m of matches) {
                const n = parseInt(m[1], 10);
                if (!isNaN(n) && n > max)
                    max = n;
            }
        });
        return max > 0 ? max : 1;
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
export const CloneManga = new CloneMangaExtension();
