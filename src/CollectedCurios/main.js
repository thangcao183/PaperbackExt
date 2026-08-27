import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.collectedcurios.com";
const AUTHOR = "Jolly Jack aka Phillip M Jackson";
const SERIES = [
    {
        mangaId: "sequentialart.php",
        title: "Sequential Art",
        description: "Sequential Art webcomic.",
        thumbnail: "https://www.collectedcurios.com/images/CC_2011_Sequential_Art_Button.jpg",
    },
    {
        mangaId: "battlebunnies.php",
        title: "Battle Bunnies",
        description: "Battle Bunnies webcomic.",
        thumbnail: "https://www.collectedcurios.com/images/CC_2011_Battle_Bunnies_Button.jpg",
    },
    {
        mangaId: "spiderandscorpion.php",
        title: "Spider and Scorpion",
        description: "Spider and Scorpion webcomic.",
        thumbnail: "https://www.collectedcurios.com/images/CC_2011_Spider_And_Scorpion_Button.jpg",
    },
];
class CollectedCuriosInterceptor extends PaperbackInterceptor {
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
export class CollectedCuriosExtension {
    requestManager = new CollectedCuriosInterceptor("main");
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
                id: "comics",
                title: "Collected Curios",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = SERIES.map((series) => ({
            type: "featuredCarouselItem",
            mangaId: series.mangaId,
            imageUrl: series.thumbnail,
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
        const items = SERIES.filter((series) => titleQuery === "" ||
            series.title.toLowerCase().includes(titleQuery)).map((series) => ({
            mangaId: series.mangaId,
            imageUrl: series.thumbnail,
            title: series.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const series = this.findSeries(mangaId);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series?.title ?? this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl: series?.thumbnail ?? "",
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: series?.description ?? "",
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
        const path = this.parsePath(sourceManga.mangaId);
        const total = this.parseChapterCount($);
        const chapters = [];
        for (let i = total; i >= 1; i--) {
            chapters.push({
                chapterId: this.toSafeId(`${path}?s=${i}`),
                sourceManga,
                title: `Chapter - ${i}`,
                volume: 0,
                chapNum: i,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const src = this.extractImage($, url);
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
    findSeries(mangaId) {
        const decoded = this.safeDecode(mangaId).replace(/^\/+/, "");
        return SERIES.find((series) => series.mangaId === decoded);
    }
    parseChapterCount($) {
        const lastHref = $("img[title=Last]").first().parent().attr("href") || "";
        const lastNum = this.numberAfterEquals(lastHref);
        if (lastNum !== undefined)
            return lastNum;
        const jumpValue = $("input[title=Jump to number]").first().attr("value");
        const jumpNum = jumpValue ? parseInt(jumpValue, 10) : NaN;
        if (!Number.isNaN(jumpNum))
            return jumpNum;
        const backHref = $("img[title=Back one]").first().parent().attr("href") || "";
        const backNum = this.numberAfterEquals(backHref);
        if (backNum !== undefined)
            return backNum + 1;
        return 1;
    }
    numberAfterEquals(href) {
        const idx = href.lastIndexOf("=");
        if (idx < 0)
            return undefined;
        const n = parseInt(href.substring(idx + 1), 10);
        return Number.isNaN(n) ? undefined : n;
    }
    extractImage($, url) {
        if (url.includes("sequentialart")) {
            return $(".w3-image").first().attr("src") || "";
        }
        if (url.includes("battlebunnies") || url.includes("spiderandscorpion")) {
            return $("#strip").first().attr("src") || "";
        }
        return ($(".w3-image").first().attr("src") ||
            $("#strip").first().attr("src") ||
            "");
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
        return slug;
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
export const CollectedCurios = new CollectedCuriosExtension();
