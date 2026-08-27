import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://randowis.com";
const MAX_PAGES = 50;
const SERIES = [
    {
        url: "/category/we-live-in-an-mmo/",
        title: "Randowiz: We live in an MMO!?",
        author: "Randowiz",
        description: "The world of 'Mamuon' where players and NPC's live together in harmony. Or do they? DO THEY?",
        thumbnail: "https://i0.wp.com/randowis.com/wp-content/uploads/2016/02/MMO_CHP_001_CSP_000.jpg?resize=800%2C800&ssl=1",
    },
    {
        url: "/category/short-comics/",
        title: "Randowiz: Short comics",
        author: "Randowiz",
        description: "So short that i have to compensate..",
        thumbnail: "https://i0.wp.com/randowis.com/wp-content/uploads/2021/10/Images_PNGs_Site_BOT-SUPPORT.png",
    },
    {
        url: "/category/art/",
        title: "Randowiz: Illustations",
        author: "Randowiz",
        description: "You like draw? I give you draw.",
        thumbnail: "https://i0.wp.com/randowis.com/wp-content/uploads/2021/05/colour-studies-021-post.jpg",
    },
];
class RandowizInterceptor extends PaperbackInterceptor {
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
export class RandowizExtension {
    requestManager = new RandowizInterceptor("main");
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
                title: "Randowiz",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = SERIES.map((s) => ({
            type: "featuredCarouselItem",
            mangaId: this.toSafeId(s.url.replace(/^\/+/, "")),
            imageUrl: s.thumbnail,
            title: s.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const items = SERIES.filter((s) => titleQuery === "" || s.title.toLowerCase().includes(titleQuery)).map((s) => ({
            mangaId: this.toSafeId(s.url.replace(/^\/+/, "")),
            imageUrl: s.thumbnail,
            title: s.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId).replace(/^\/+/, "").replace(/\/+$/, "");
        const series = SERIES.find((s) => s.url.replace(/^\/+/, "").replace(/\/+$/, "") === slug) ?? SERIES[0];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title,
                secondaryTitles: [],
                thumbnailUrl: series.thumbnail,
                author: series.author,
                artist: series.author,
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
        let url = this.mangaUrl(sourceManga.mangaId);
        const entries = [];
        const seen = new Set();
        for (let i = 0; i < MAX_PAGES; i++) {
            const $ = await this.fetchCheerio({ url, method: "GET" });
            $(".has-post-thumbnail").each((_index, element) => {
                const el = $(element);
                const linkTag = el.find(".elementor-post__title a").first();
                const href = linkTag.attr("href") || "";
                if (!href)
                    return;
                const chapterId = this.parsePath(href);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const dateText = el.find(".elementor-post-date").first().text().trim();
                entries.push({
                    chapterId,
                    name: linkTag.text().trim(),
                    date: this.parseDate(dateText),
                });
            });
            const nextUrl = $(".next").first().attr("href") || "";
            if (!nextUrl)
                break;
            url = this.absoluteUrl(nextUrl);
        }
        return entries.map((entry, index) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.name,
            volume: 0,
            chapNum: entries.length - index,
            publishDate: entry.date,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $(".elementor-widget-theme-post-content img").each((_index, element) => {
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
    parseDate(text) {
        // Upstream format: dd/MM/yyyy
        const m = (text || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!m)
            return new Date(0);
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const year = parseInt(m[3], 10);
        const d = new Date(Date.UTC(year, month, day));
        return isNaN(d.getTime()) ? new Date(0) : d;
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
export const Randowiz = new RandowizExtension();
