import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://xlecx.one";
class XlecXInterceptor extends PaperbackInterceptor {
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
export class XlecXExtension {
    requestManager = new XlecXInterceptor("main");
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
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const url = section.id === "popular"
            ? this.listUrl("sort=news_read/order=desc", page)
            : this.listUrl("sort=date/order=desc", page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("#dle-content > a.thumb").each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
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
        const hasNextPage = this.hasNextPage($);
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
        const params = [
            "do=search",
            "subaction=search",
            `search_start=${page}`,
            "full_search=0",
            `story=${encodeURIComponent(titleQuery)}`,
        ];
        const url = `${BASE_URL}/index.php?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $("#dle-content > a.thumb").each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
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
        const hasNextPage = this.hasNextPage($);
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    itemFromElement($, el) {
        const href = el.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const img = el.find("img").first();
        const title = (img.attr("alt") || "").trim();
        const imageUrl = this.imageFromElement(img);
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
        const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
        const artist = this.subInfoLinks($, "Artist:");
        const author = this.subInfoLinks($, "Group:");
        const genreText = this.subInfoLinks($, "Tags:");
        const thumbnailUrl = this.absoluteUrl($("meta[property=og:image]").first().attr("content") || "");
        const tagGroups = [];
        const genres = genreText
            .split(",")
            .map((g) => g.trim())
            .filter((g) => g.length > 0);
        if (genres.length > 0) {
            tagGroups.push({
                id: "tags",
                title: "Tags",
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
                synopsis: "",
                contentRating: ContentRating.MATURE,
                status: "Completed",
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
        const dto = this.parseJsonLd($);
        const book = dto?.["@graph"]?.[0];
        const dateStr = book?.dateModified || book?.datePublished;
        const publishDate = this.parseDate(dateStr);
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter",
                volume: 0,
                chapNum: 1,
                publishDate,
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const url = this.mangaUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        // 'Full size' tab
        $("#content-2 > .imagegall23 > img").each((_, element) => {
            const el = $(element);
            const src = el.attr("data-src") || el.attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
        });
        if (pages.length > 0) {
            return this.buildDetails(chapter, pages);
        }
        // Plain
        $(".page__text a:has(img)").each((_, element) => {
            const href = $(element).attr("href") || "";
            if (href)
                pages.push(this.absoluteUrl(href));
        });
        if (pages.length > 0) {
            return this.buildDetails(chapter, pages);
        }
        // 'Thumb' tab
        $("#content-1 > .imagegall23 > img").each((_, element) => {
            const el = $(element);
            const src = el.attr("data-src") || el.attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
        });
        if (pages.length > 0) {
            return this.buildDetails(chapter, pages);
        }
        // JSON-LD fallback
        const dto = this.parseJsonLd($);
        const book = dto?.["@graph"]?.[0];
        for (const imageUrl of book?.image ?? []) {
            if (imageUrl)
                pages.push(this.absoluteUrl(imageUrl));
        }
        return this.buildDetails(chapter, pages);
    }
    buildDetails(chapter, pages) {
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
    listUrl(filter, page) {
        const pageStr = page > 1 ? `page/${page}/` : "";
        return `${BASE_URL}/f/${filter}/${pageStr}`;
    }
    hasNextPage($) {
        let found = false;
        $("#pagination > .pagination__pages > a").each((_, element) => {
            if ($(element).text().includes("Next"))
                found = true;
        });
        return found;
    }
    subInfoLinks($, label) {
        const texts = [];
        $(".page__subinfo-item > div:not([class])").each((_, element) => {
            const el = $(element);
            if (!el.text().includes(label))
                return;
            el.nextAll("a").each((_i, a) => {
                const t = $(a).text().trim();
                if (t)
                    texts.push(t);
            });
        });
        return texts.join(", ");
    }
    parseJsonLd($) {
        const script = $("script[type=application/ld+json]").first().text().trim();
        if (!script)
            return undefined;
        try {
            return JSON.parse(script);
        }
        catch {
            return undefined;
        }
    }
    parseDate(dateStr) {
        if (!dateStr)
            return new Date(0);
        const t = Date.parse(dateStr);
        if (Number.isNaN(t))
            return new Date(0);
        return new Date(t);
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
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
export const XlecX = new XlecXExtension();
