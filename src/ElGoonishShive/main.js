import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.egscomics.com";
const AUTHOR = "Dan Shive";
const THUMBNAIL = "https://static.tumblr.com/8cee5e83d26a8a96ad5e51b67f2e340e/j8ipbno/fXFoj0zh9/tumblr_static_1f2fhwjyya74gsgs888g8k880.png";
const BASE_DESCRIPTION = "El Goonish Shive is a comic about a group of teenagers who face " +
    "both real life and bizarre, supernatural situations. \n\n" +
    "It is a comedy mixed with drama and is recommended for audiences thirteen " +
    "and older.";
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
const SERIES = [
    {
        id: "comic/archive",
        prefix: "comic",
        title: "El Goonish Shive",
        description: BASE_DESCRIPTION,
    },
    {
        id: "egsnp/archive",
        prefix: "egsnp",
        title: "El Goonish Shive: NewsPaper",
        description: BASE_DESCRIPTION +
            " \n\n" +
            "EGS:NP is a subsection with short stories that generally aren't canon " +
            "unless stated",
    },
    {
        id: "sketchbook/archive",
        prefix: "sketchbook",
        title: "El Goonish Shive Sketchbook",
        description: BASE_DESCRIPTION +
            " \n\n" +
            "The Sketchbook section is full of one-shot gags, sketches, comics that " +
            "don't fit elsewhere.",
    },
];
class ElGoonishShiveInterceptor extends PaperbackInterceptor {
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
export class ElGoonishShiveExtension {
    requestManager = new ElGoonishShiveInterceptor("main");
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
                id: "series",
                title: "El Goonish Shive",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = SERIES.map((series) => ({
            type: "featuredCarouselItem",
            mangaId: this.toSafeId(series.id),
            imageUrl: THUMBNAIL,
            title: series.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const items = [];
        for (const series of SERIES) {
            if (titleQuery === "" ||
                series.title.toLowerCase().includes(titleQuery)) {
                items.push({
                    mangaId: this.toSafeId(series.id),
                    imageUrl: THUMBNAIL,
                    title: series.title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            }
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const series = this.seriesFromId(mangaId);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title,
                secondaryTitles: [],
                thumbnailUrl: THUMBNAIL,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: series.description,
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
        const series = this.seriesFromId(sourceManga.mangaId);
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        const seen = new Set();
        $("select[name=comic] option").each((_index, element) => {
            const el = $(element);
            const value = (el.attr("value") || "").trim();
            if (!value || !value.startsWith(series.prefix))
                return;
            const chapterId = this.toSafeId(value.replace(/^\/+/, ""));
            if (seen.has(chapterId))
                return;
            seen.add(chapterId);
            const text = el.text().trim();
            const parts = text.split(" - ");
            const datePart = parts[0] || "";
            const name = parts.length > 1 ? parts.slice(1).join(" - ") : text;
            const chapNum = el.prevAll("option").length;
            entries.push({
                chapterId,
                name,
                publishDate: this.parseDate(datePart),
                chapNum,
            });
        });
        return entries.reverse().map((entry) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.name,
            volume: 0,
            chapNum: entry.chapNum,
            publishDate: entry.publishDate,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("#cc-comic").each((_index, element) => {
            const src = $(element).attr("src") || "";
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
    seriesFromId(mangaId) {
        const slug = this.safeDecode(mangaId).replace(/^\/+/, "");
        const match = SERIES.find((s) => slug.startsWith(s.prefix));
        return match ?? SERIES[0];
    }
    parseDate(text) {
        const t = text.trim().toLowerCase();
        const m = t.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (!m)
            return new Date(0);
        const month = MONTHS[m[1]];
        if (month === undefined)
            return new Date(0);
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        return new Date(Date.UTC(year, month, day));
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
export const ElGoonishShive = new ElGoonishShiveExtension();
