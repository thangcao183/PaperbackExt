import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://bbato.com";
const GENRES = [
    { id: "action", title: "Action" },
    { id: "adventure", title: "Adventure" },
    { id: "avant-garde", title: "Avant Garde" },
    { id: "boys-love", title: "Boys Love" },
    { id: "comedy", title: "Comedy" },
    { id: "demons", title: "Demons" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "girls-love", title: "Girls Love" },
    { id: "gourmet", title: "Gourmet" },
    { id: "harem", title: "Harem" },
    { id: "horror", title: "Horror" },
    { id: "isekai", title: "Isekai" },
    { id: "iyashikei", title: "Iyashikei" },
    { id: "josei", title: "Josei" },
    { id: "kids", title: "Kids" },
    { id: "magic", title: "Magic" },
    { id: "mahou-shoujo", title: "Mahou Shoujo" },
    { id: "martial-arts", title: "Martial Arts" },
    { id: "mecha", title: "Mecha" },
    { id: "military", title: "Military" },
    { id: "music", title: "Music" },
    { id: "mystery", title: "Mystery" },
    { id: "parody", title: "Parody" },
    { id: "psychological", title: "Psychological" },
    { id: "reverse-harem", title: "Reverse Harem" },
    { id: "romance", title: "Romance" },
    { id: "school", title: "School" },
    { id: "sci-fi", title: "Sci-Fi" },
    { id: "seinen", title: "Seinen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shounen", title: "Shounen" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "space", title: "Space" },
    { id: "sports", title: "Sports" },
    { id: "super-power", title: "Super Power" },
    { id: "supernatural", title: "Supernatural" },
    { id: "suspense", title: "Suspense" },
    { id: "thriller", title: "Thriller" },
    { id: "vampire", title: "Vampire" },
];
class BbatoInterceptor extends PaperbackInterceptor {
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
export class BbatoExtension {
    requestManager = new BbatoInterceptor("main");
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
                title: "Most Viewed",
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
                    metadata: { searchMeta: { genre: g.id } },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        if (section.id === "popular") {
            const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });
            const items = [];
            const seen = new Set();
            $("#most-viewed .tab-content .swiper-slide.unit").each((_, element) => {
                const el = $(element);
                const href = el.find("a").first().attr("href") || "";
                if (!href)
                    return;
                const mangaId = this.parsePath(href);
                if (!mangaId || seen.has(mangaId))
                    return;
                const title = el.find("span").first().text().trim();
                if (!title)
                    return;
                const imageUrl = this.imageFromElement(el.find("img").first());
                seen.add(mangaId);
                items.push({
                    type: "featuredCarouselItem",
                    mangaId,
                    imageUrl,
                    title,
                    metadata: undefined,
                });
            });
            return { items, metadata: undefined };
        }
        // latest
        const meta = metadata;
        const page = meta?.page ?? 1;
        const path = page === 1 ? "/updated" : `/updated/page/${page}`;
        const $ = await this.fetchCheerio({ url: `${BASE_URL}${path}`, method: "GET" });
        const items = [];
        $(".original.card-lg .unit").each((_, element) => {
            const el = $(element);
            const parsed = this.latestItemFromElement($, el);
            if (!parsed)
                return;
            items.push({
                type: "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNext = $(".pagination a[rel=next]").length > 0;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const params = [];
        params.push(`keyword=${encodeURIComponent(titleQuery)}`);
        if (page > 1)
            params.push(`page=${page}`);
        if (searchMeta?.genre) {
            params.push(`genre[]=${encodeURIComponent(searchMeta.genre)}`);
        }
        const url = `${BASE_URL}/filter?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $(".original.card-lg .unit").each((_, element) => {
            const el = $(element);
            const parsed = this.latestItemFromElement($, el);
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
        const hasNext = $(".pagination a[rel=next]").length > 0;
        return { items: results, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    latestItemFromElement($, el) {
        const href = el.find("a.poster").first().attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = el.find(".info > a").first().text().trim();
        if (!title)
            return undefined;
        const imageUrl = this.imageFromElement(el.find("a.poster img").first());
        return { mangaId, imageUrl, title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("h1[itemprop=name]").first().text().trim() || this.safeDecode(mangaId);
        const author = $(".meta div:has(span:contains(Author)) a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0)
            .join(", ");
        const synopsis = $(".description").first().text().trim();
        const genres = $(".meta div:has(span:contains(Genres)) a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const statusText = $(".info > p").first().text();
        const thumbnailUrl = this.imageFromElement($(".poster img").first());
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
                artist: undefined,
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
        const slug = this.mangaSlug(sourceManga.mangaId);
        const mangaUrl = this.mangaUrl(sourceManga.mangaId);
        const url = `${BASE_URL}/get-chapter-list?slug=${encodeURIComponent(slug)}`;
        const [, data] = await Application.scheduleRequest({
            url,
            method: "GET",
            headers: {
                accept: "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                referer: mangaUrl,
            },
        });
        let parsed = {};
        try {
            parsed = JSON.parse(Application.arrayBufferToUTF8String(data));
        }
        catch {
            parsed = {};
        }
        const list = parsed.data ?? [];
        const chapters = [];
        const seen = new Set();
        list.forEach((dto, index) => {
            const chapterSlug = dto.chapter_slug ?? "";
            if (!chapterSlug)
                return;
            const chapterId = this.toSafeId(`read/${slug}/${chapterSlug}`);
            if (seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = dto.chapter_name ?? "";
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name, list.length - index),
                publishDate: this.parseDate(dto.updated_at),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $(".pages .page:not(.notice-page) img").each((_, element) => {
            const src = this.imageFromElement($(element));
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
    mangaSlug(mangaId) {
        const decoded = this.safeDecode(mangaId)
            .replace(/[?#].*$/, "")
            .replace(/\/+$/, "");
        return decoded.split("/").pop() || decoded;
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
    parseChapterNumber(name, fallback) {
        const m = (name || "").match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : fallback;
    }
    parseDate(raw) {
        if (!raw)
            return new Date(0);
        const normalized = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
        const d = new Date(normalized);
        return isNaN(d.getTime()) ? new Date(0) : d;
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
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing") || s.includes("releasing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("hiatus"))
            return "Hiatus";
        if (s.includes("discontinued") || s.includes("cancelled"))
            return "Cancelled";
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
export const Bbato = new BbatoExtension();
