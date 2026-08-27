import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://fanfox.net";
const MOBILE_URL = "https://m.fanfox.net";
const GENRES = [
    { id: 1, title: "Action" },
    { id: 2, title: "Adventure" },
    { id: 3, title: "Comedy" },
    { id: 4, title: "Drama" },
    { id: 5, title: "Fantasy" },
    { id: 6, title: "Martial Arts" },
    { id: 7, title: "Shounen" },
    { id: 8, title: "Horror" },
    { id: 9, title: "Supernatural" },
    { id: 10, title: "Harem" },
    { id: 11, title: "Psychological" },
    { id: 12, title: "Romance" },
    { id: 13, title: "School Life" },
    { id: 14, title: "Shoujo" },
    { id: 15, title: "Mystery" },
    { id: 16, title: "Sci-fi" },
    { id: 17, title: "Seinen" },
    { id: 18, title: "Tragedy" },
    { id: 19, title: "Ecchi" },
    { id: 20, title: "Sports" },
    { id: 21, title: "Slice of Life" },
    { id: 22, title: "Mature" },
    { id: 23, title: "Shoujo Ai" },
    { id: 24, title: "Webtoons" },
    { id: 25, title: "Doujinshi" },
    { id: 26, title: "One Shot" },
    { id: 27, title: "Smut" },
    { id: 28, title: "Yaoi" },
    { id: 29, title: "Josei" },
    { id: 30, title: "Historical" },
    { id: 31, title: "Shounen Ai" },
    { id: 32, title: "Gender Bender" },
    { id: 33, title: "Adult" },
    { id: 34, title: "Yuri" },
    { id: 35, title: "Mecha" },
    { id: 36, title: "Lolicon" },
    { id: 37, title: "Shotacon" },
];
class MangaFoxInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        const isMobile = request.url.includes("m.fanfox.net");
        request.headers = {
            ...request.headers,
            referer: `${isMobile ? MOBILE_URL : BASE_URL}/`,
            origin: isMobile ? MOBILE_URL : BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            // Force readway=2 (all page URLs at once) on mobile, isAdult=1 on main.
            cookie: isMobile ? "readway=2" : "isAdult=1",
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
export class MangaFoxExtension {
    requestManager = new MangaFoxInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 1,
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
                id: "popular",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "genres",
                title: "Genres",
                type: DiscoverSectionType.genres,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id === "genres") {
            const items = GENRES.map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre: g.id },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const pageStr = page !== 1 ? `${page}.html` : "";
        const suffix = section.id === "latest" ? "?latest" : "";
        const url = `${BASE_URL}/directory/${pageStr}${suffix}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("ul.manga-list-1-list li").each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed || seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $(".pager-list-left a.active + a + a").length > 0;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const genre = query.metadata?.genre;
        const params = [];
        params.push(`title=${encodeURIComponent(titleQuery)}`);
        params.push(`genres=${genre != null ? genre : ""}`);
        params.push("nogenres=");
        params.push("sort=");
        params.push("stype=1");
        if (page !== 1)
            params.push(`page=${page}`);
        const url = `${BASE_URL}/search?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $("ul.manga-list-4-list li").each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed || seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $(".pager-list-left a.active + a + a").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    itemFromElement($, el) {
        const link = el.find("a").first();
        const href = link.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = (link.attr("title") || link.text() || "").trim();
        const imageUrl = this.imageFromElement(el.find("img").first());
        if (!title)
            return undefined;
        return { mangaId, imageUrl, title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const info = $(".detail-info-right").first();
        const author = info
            .find(".detail-info-right-say a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0)
            .join(", ");
        const genres = info
            .find(".detail-info-right-tag-list a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const synopsis = info.find("p.fullcontent").first().text().trim();
        const statusText = info
            .find(".detail-info-right-title-tip")
            .first()
            .text()
            .trim();
        const thumbnailUrl = this.imageFromElement($(".detail-info-cover-img").first());
        const title = info.find(".detail-info-right-title-font").first().text().trim() ||
            this.safeDecode(mangaId);
        const tagGroups = [];
        if (genres.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genres.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: author || undefined,
                artist: author || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(statusText),
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        $("ul.detail-main-list li a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const ps = el.find(".detail-main-list-main p");
            const name = ps.first().text().trim();
            const dateText = ps.last().text().trim();
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
                publishDate: this.parseChapterDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters.map((chapter, index) => ({
            ...chapter,
            chapNum: chapter.chapNum || chapters.length - index,
        }));
    }
    async getChapterDetails(chapter) {
        const slug = this.safeDecode(chapter.chapterId).replace(/^\/+/, "");
        const mobilePath = slug.replace(/manga\//, "roll_manga/");
        const url = `${MOBILE_URL}/${mobilePath}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("#viewer img").each((_, element) => {
            const src = $(element).attr("data-original") || $(element).attr("src") || "";
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
    parseChapterNumber(name) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    parseChapterDate(date) {
        const d = (date || "").trim();
        if (!d)
            return new Date(0);
        const now = new Date();
        if (d.includes("Today") || d.includes(" ago")) {
            now.setHours(0, 0, 0, 0);
            return now;
        }
        if (d.includes("Yesterday")) {
            now.setDate(now.getDate() - 1);
            now.setHours(0, 0, 0, 0);
            return now;
        }
        // Format: "MMM d,yyyy" e.g. "Jan 5,2024"
        const m = d.match(/([A-Za-z]{3})\s+(\d{1,2}),(\d{4})/);
        if (m) {
            const months = {
                Jan: 0,
                Feb: 1,
                Mar: 2,
                Apr: 3,
                May: 4,
                Jun: 5,
                Jul: 6,
                Aug: 7,
                Sep: 8,
                Oct: 9,
                Nov: 10,
                Dec: 11,
            };
            const month = months[m[1]];
            if (month != null) {
                return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
            }
        }
        const parsed = new Date(d);
        return isNaN(parsed.getTime()) ? new Date(0) : parsed;
    }
    imageFromElement(img) {
        const src = img.attr("data-original") ||
            img.attr("data-src") ||
            img.attr("data-lazy-src") ||
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
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        return "Unknown";
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
export const MangaFox = new MangaFoxExtension();
