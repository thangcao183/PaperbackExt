import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { VyvyMangaSearchForm } from "./forms";
const BASE_URL = "https://mangavyvy.net";
class VyvyMangaInterceptor extends PaperbackInterceptor {
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
export class VyvyMangaExtension {
    requestManager = new VyvyMangaInterceptor("main");
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
        return new VyvyMangaSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        let url;
        if (section.id === "latest") {
            url = `${BASE_URL}/search?sort=updated_at${page !== 1 ? `&page=${page}` : ""}`;
        }
        else {
            url = `${BASE_URL}/search${page !== 1 ? `?page=${page}` : ""}`;
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        this.eachListItem($, (parsed) => {
            items.push({
                type: section.id === "latest"
                    ? "simpleCarouselItem"
                    : "featuredCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("[rel=next]").length > 0;
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
        const url = this.buildSearchUrl(titleQuery, searchMeta, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        this.eachListItem($, (parsed) => {
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("[rel=next]").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    buildSearchUrl(titleQuery, searchMeta, page) {
        const params = [];
        if (titleQuery) {
            params.push(`q=${encodeURIComponent(titleQuery)}`);
        }
        params.push(`page=${page}`);
        const searchType = searchMeta?.searchType?.[0];
        if (searchType)
            params.push(`search_po=${encodeURIComponent(searchType)}`);
        if ((searchMeta?.searchDescription?.[0] ?? "") === "1") {
            params.push("check_search_desc=1");
        }
        const author = (searchMeta?.author ?? "").trim();
        if (author) {
            const authorType = searchMeta?.authorSearchType?.[0];
            if (authorType)
                params.push(`author_po=${encodeURIComponent(authorType)}`);
            params.push(`author=${encodeURIComponent(author)}`);
        }
        const status = searchMeta?.status?.[0];
        if (status)
            params.push(`completed=${encodeURIComponent(status)}`);
        const sort = searchMeta?.sort?.[0];
        if (sort)
            params.push(`sort=${encodeURIComponent(sort)}`);
        const sortType = searchMeta?.sortType?.[0];
        if (sortType)
            params.push(`sort_type=${encodeURIComponent(sortType)}`);
        for (const genre of searchMeta?.includeGenres ?? []) {
            params.push(`genre[]=${encodeURIComponent(genre)}`);
        }
        for (const genre of searchMeta?.excludeGenres ?? []) {
            params.push(`exclude_genre[]=${encodeURIComponent(genre)}`);
        }
        return `${BASE_URL}/search?${params.join("&")}`;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
        const thumbnailUrl = this.absoluteUrl($(".img-manga img").first().attr("src") || "");
        const synopsis = $(".summary > .content").first().text().trim();
        const author = $(".pre-title:contains(Author) ~ a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0)
            .join(", ");
        const artist = $(".pre-title:contains(Artist) ~ a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0)
            .join(", ");
        const statusText = $(".pre-title:contains(Status) ~ span:not(.space)")
            .first()
            .text()
            .trim();
        const genres = $(".pre-title:contains(Genres) ~ a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
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
                artist: artist || undefined,
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
        $(".list-group > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const name = el.find("span").first().text().trim();
            const dateText = el.find("> p").first().text().trim();
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
                publishDate: this.parseChapterDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("img.d-block").each((_, element) => {
            const src = $(element).attr("data-src") || "";
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
    eachListItem($, cb) {
        $(".comic-item").each((_, element) => {
            const el = $(element);
            const parsed = this.parseListItem($, el);
            if (parsed)
                cb(parsed);
        });
    }
    parseListItem($, el) {
        const link = el.find("a").first();
        const href = link.attr("href") || "";
        const title = el.find(".comic-title").first().text().trim();
        if (!href || !title)
            return undefined;
        const imageUrl = this.absoluteUrl(el.find(".comic-image img.image.lozad").first().attr("data-src") || "");
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
        const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
        // VyvyManga uses absolute http URLs for both manga and chapters; keep them.
        return this.toSafeId(cleaned);
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
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        return "Unknown";
    }
    parseChapterDate(dateText) {
        if (!dateText)
            return new Date(0);
        const text = dateText.trim();
        if (/ago$/i.test(text)) {
            const m = text.match(/(\d+)/);
            const n = m ? parseInt(m[1], 10) : 0;
            const now = Date.now();
            if (/day/i.test(text))
                return new Date(now - n * 86400000);
            if (/hour/i.test(text))
                return new Date(now - n * 3600000);
            if (/minute/i.test(text))
                return new Date(now - n * 60000);
            if (/second/i.test(text))
                return new Date(now - n * 1000);
            if (/week/i.test(text))
                return new Date(now - n * 7 * 86400000);
            if (/month/i.test(text))
                return new Date(now - n * 30 * 86400000);
            if (/year/i.test(text))
                return new Date(now - n * 365 * 86400000);
            return new Date(now);
        }
        const fallback = new Date(text);
        return isNaN(fallback.getTime()) ? new Date(0) : fallback;
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
export const VyvyManga = new VyvyMangaExtension();
