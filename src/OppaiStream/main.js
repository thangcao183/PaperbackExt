import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { OppaiStreamSearchForm } from "./forms";
const BASE_URL = "https://read.oppai.stream";
const CDN_URL = "https://myspacecat.pictures";
const SEARCH_LIMIT = 36;
class OppaiStreamInterceptor extends PaperbackInterceptor {
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
export class OppaiStreamExtension {
    requestManager = new OppaiStreamInterceptor("main");
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
                id: "popular",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata;
        return new OppaiStreamSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const order = section.id === "popular" ? "views" : "uploaded";
        const url = this.buildSearchUrl("", order, [], [], page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const elements = $("div.in-grid > a");
        const items = [];
        elements.each((_, element) => {
            const parsed = this.parseListItem($, $(element));
            if (!parsed)
                return;
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
        const hasNextPage = elements.length >= SEARCH_LIMIT;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const order = searchMeta?.order?.[0] ?? "";
        const includeGenres = searchMeta?.includeGenres ?? [];
        const excludeGenres = searchMeta?.excludeGenres ?? [];
        const url = this.buildSearchUrl(titleQuery, order, includeGenres, excludeGenres, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const elements = $("div.in-grid > a");
        const results = [];
        elements.each((_, element) => {
            const parsed = this.parseListItem($, $(element));
            if (!parsed)
                return;
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = elements.length >= SEARCH_LIMIT;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    buildSearchUrl(text, order, includeGenres, excludeGenres, page) {
        const params = [];
        params.push(`text=${encodeURIComponent(text)}`);
        if (order)
            params.push(`order=${encodeURIComponent(order)}`);
        if (includeGenres.length > 0) {
            params.push(`genres=${encodeURIComponent(includeGenres.join(","))}`);
        }
        if (excludeGenres.length > 0) {
            params.push(`blacklist=${encodeURIComponent(excludeGenres.join(","))}`);
        }
        params.push(`page=${page}`);
        params.push(`limit=${SEARCH_LIMIT}`);
        return `${BASE_URL}/api-search.php?${params.join("&")}`;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const thumbnailUrl = this.absoluteUrl($(".cover-img").first().attr("src") || "");
        const info = $(".manhwa-info-in").first();
        const h1 = info.find("h1").first();
        const title = h1.text().split("By")[0].trim() || this.safeDecode(mangaId);
        const author = info.find("a.red").first().text().trim();
        const genres = info
            .find(".genres h5")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const synopsis = info.find(".description").first().text().trim();
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
                status: "Unknown",
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
        $(".sort-chapters > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const name = el.find("div > h4").first().text().trim();
            const dateText = el.find("div > h6").first().text().trim();
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
                publishDate: this.parseRelativeDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const chapterUrl = this.chapterUrl(chapter.chapterId);
        const slug = this.queryParam(chapterUrl, "m");
        const chapNo = this.queryParam(chapterUrl, "c");
        const url = `${CDN_URL}/manhwa/im.php?f-m=${encodeURIComponent(slug)}&c=${encodeURIComponent(chapNo)}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("img").each((_, element) => {
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
    parseListItem($, el) {
        const title = el.find("h3.man-title").first().text().trim();
        let href = el.attr("href") || "";
        if (!href || !title)
            return undefined;
        if (href.includes("/fw?to=")) {
            href = this.safeDecode(href.split("/fw?to=")[1] || "");
        }
        const imageUrl = this.absoluteUrl(el.find("img.read-cover").first().attr("src") || "");
        return { mangaId: this.parsePath(href), title, imageUrl };
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
        const cleaned = decoded.replace(/#.*$/, "");
        const slug = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        return this.toSafeId(slug);
    }
    queryParam(url, key) {
        const match = url.match(new RegExp(`[?&]${key}=([^&#]*)`));
        return match ? this.safeDecode(match[1]) : "";
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
        const match = name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : -1;
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
    parseRelativeDate(dateText) {
        if (!dateText)
            return new Date(0);
        const num = parseInt(dateText.split(" ")[0].trim(), 10);
        if (isNaN(num))
            return new Date(0);
        const now = new Date();
        const lower = dateText.toLowerCase();
        if (lower.includes("second"))
            now.setSeconds(now.getSeconds() - num);
        else if (lower.includes("minute"))
            now.setMinutes(now.getMinutes() - num);
        else if (lower.includes("hour"))
            now.setHours(now.getHours() - num);
        else if (lower.includes("day"))
            now.setDate(now.getDate() - num);
        else if (lower.includes("week"))
            now.setDate(now.getDate() - num * 7);
        else if (lower.includes("month"))
            now.setMonth(now.getMonth() - num);
        else if (lower.includes("year"))
            now.setFullYear(now.getFullYear() - num);
        else
            return new Date(0);
        return now;
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
export const OppaiStream = new OppaiStreamExtension();
