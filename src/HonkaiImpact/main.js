import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://manga.honkaiimpact3.com";
class HonkaiImpactInterceptor extends PaperbackInterceptor {
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
export class HonkaiImpactExtension {
    requestManager = new HonkaiImpactInterceptor("main");
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
    // Discover sections (supportsLatest=false -> single popular section)
    // ----------------------------------------------------------------
    async getDiscoverSections() {
        return [
            {
                id: "books",
                title: "All Books",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const books = await this.fetchBooks();
        const items = books.map((b) => ({
            type: "featuredCarouselItem",
            mangaId: b.mangaId,
            imageUrl: b.imageUrl,
            title: b.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search (client-side filter of /book)
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const books = await this.fetchBooks();
        const items = books
            .filter((b) => !titleQuery || b.title.toLowerCase().includes(titleQuery))
            .map((b) => ({
            mangaId: b.mangaId,
            imageUrl: b.imageUrl,
            title: b.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    async fetchBooks() {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/book`,
            method: "GET",
        });
        const books = [];
        $("a[href*=book]").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            const title = el.find(".container-title").first().text().trim();
            if (!href || !title)
                return;
            const imageUrl = this.absoluteUrl(el.find(".container-cover img").first().attr("src") || "");
            books.push({ mangaId: this.parsePath(href), title, imageUrl });
        });
        return books;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("div.title").first().text().trim() || this.safeDecode(mangaId);
        const thumbnailUrl = this.absoluteUrl($("img.cover").first().attr("src") || "");
        const synopsis = $("div.detail_info1").first().text().trim();
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
    // Chapters (JSON API at {mangaUrl}/get_chapter)
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = `${this.mangaUrl(sourceManga.mangaId)}/get_chapter`;
        const list = await this.fetchJson({
            url,
            method: "GET",
        });
        return list.map((dto) => ({
            chapterId: this.toSafeId(`book/${dto.bookid}/${Math.trunc(dto.chapterid)}`),
            sourceManga,
            title: dto.title,
            volume: 0,
            chapNum: dto.chapterid,
            publishDate: this.parseDate(dto.timestamp),
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("img.lazy.comic_img").each((_, element) => {
            const src = $(element).attr("data-original") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
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
    parseDate(dateText) {
        if (!dateText)
            return new Date(0);
        // Format yyyy-MM-dd HH:mm:ss
        const normalized = dateText.trim().replace(" ", "T");
        const d = new Date(normalized);
        return isNaN(d.getTime()) ? new Date(0) : d;
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
}
export const HonkaiImpact = new HonkaiImpactExtension();
