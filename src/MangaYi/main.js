import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://mangayi.com";
const COVER_BASE = "https://scp.keterfoundation.com/cover";
class MangaYiInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            "user-agent": await Application.getDefaultUserAgent(),
            "accept-language": "en-US,en;q=0.5",
        };
        return request;
    }
    async interceptResponse(request, response, data) {
        if (response.headers?.["cf-mitigated"] === "challenge") {
            throw new CloudflareError({
                url: request.url,
                method: request.method ?? "GET",
                headers: { "user-agent": await Application.getDefaultUserAgent() },
            });
        }
        return data;
    }
}
class MangaYiExtension {
    requestManager = new MangaYiInterceptor("main");
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
    async getDiscoverSections() {
        return [
            {
                id: "popular",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const list = await this.fetchSearch({ t: 1 });
        return {
            items: list.map((manga) => ({
                type: "featuredCarouselItem",
                mangaId: this.toSafeId(manga.i),
                imageUrl: this.coverUrl(manga.i),
                title: manga.t,
                metadata: undefined,
            })),
            metadata: undefined,
        };
    }
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim();
        const list = titleQuery
            ? await this.fetchSearch({ s: titleQuery })
            : await this.fetchSearch({ t: 1 });
        return {
            items: list.map((manga) => ({
                mangaId: this.toSafeId(manga.i),
                title: manga.t,
                imageUrl: this.coverUrl(manga.i),
                metadata: undefined,
            })),
            metadata: undefined,
        };
    }
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const $ = await this.fetchCheerio({ url: this.mangaUrl(slug), method: "GET" });
        const title = $("h1.title").first().text().trim();
        const author = $(".authors").first().text().trim();
        const descParts = [];
        $(".summary p").each((_, el) => {
            const t = $(el).text().trim();
            if (t)
                descParts.push(t);
        });
        const genres = [];
        $(".genres .pill").each((_, el) => {
            const t = $(el).text().trim();
            if (t)
                genres.push(t);
        });
        const tagGroups = genres.length > 0
            ? [
                {
                    id: "genres",
                    title: "Genres",
                    tags: genres.map((g) => ({
                        id: g.toLowerCase().replace(/\s+/g, "-"),
                        title: g,
                    })),
                },
            ]
            : [];
        const statusText = $(".stat:contains(Status) .value").first().text().trim();
        const thumbnail = this.absoluteUrl($(".cover-wrapper img.cover-image").first().attr("src") || "") || this.coverUrl(slug);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title || slug,
                secondaryTitles: [],
                thumbnailUrl: thumbnail,
                author: author || undefined,
                synopsis: descParts.join("\n"),
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(statusText),
                tagGroups,
                shareUrl: this.mangaUrl(slug),
            },
        };
    }
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url: this.mangaUrl(slug), method: "GET" });
        const elements = $("div.chapters a.c:not(.unreleased)").toArray();
        const total = elements.length;
        const result = [];
        elements.forEach((el, index) => {
            const anchor = $(el);
            const href = anchor.attr("href");
            if (!href)
                return;
            const name = anchor.find(".t").first().text().trim() || "Chapter";
            const dateText = anchor.find(".chapter-date").first().text().trim();
            result.push({
                chapterId: this.parseChapterId(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: total - index,
                publishDate: this.parseDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return result;
    }
    async getChapterDetails(chapter) {
        const $ = await this.fetchCheerio({
            url: this.chapterUrl(chapter.chapterId),
            method: "GET",
        });
        const pages = [];
        $("div.images img").each((_, el) => {
            const src = this.absoluteUrl($(el).attr("src") || "");
            if (src)
                pages.push(src);
        });
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(this.safeDecode(mangaId));
    }
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
    // ---- helpers ----
    async fetchSearch(payload) {
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/api/search`,
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (response.status === 404)
            return [];
        try {
            const parsed = JSON.parse(Application.arrayBufferToUTF8String(data));
            return (Array.isArray(parsed) ? parsed : []).filter((m) => m.i && m.t);
        }
        catch {
            return [];
        }
    }
    coverUrl(slug) {
        return `${COVER_BASE}/${slug}.jpg`;
    }
    mangaUrl(slug) {
        const s = slug.startsWith("http") ? slug : slug.replace(/^\/+|\/+$/g, "");
        if (s.startsWith("http"))
            return s;
        return `${BASE_URL}/read/${s}/`;
    }
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parseChapterId(href) {
        const cleaned = href.replace(/[#].*$/, "").replace(/\/+$/, "");
        const slug = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        return this.toSafeId(slug);
    }
    parseStatus(status) {
        const s = (status ?? "").toLowerCase();
        if (s === "ongoing")
            return "Ongoing";
        if (s === "completed")
            return "Completed";
        if (s === "hiatus" || s === "on hiatus")
            return "Hiatus";
        if (s === "cancelled")
            return "Cancelled";
        return "Unknown";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const t = Date.parse(value);
        return isNaN(t) ? new Date(0) : new Date(t);
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
export const MangaYi = new MangaYiExtension();
