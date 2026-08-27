import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://readallcomics.com";
class ReadAllComicsInterceptor extends PaperbackInterceptor {
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
export class ReadAllComicsExtension {
    requestManager = new ReadAllComicsInterceptor("main");
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
        ];
    }
    async getDiscoverSectionItems(_section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const url = page === 1 ? BASE_URL : `${BASE_URL}/?paged=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        $("ul.list-story.categories li").each((_, element) => {
            const parsed = this.parseListItem($, element);
            if (!parsed)
                return;
            items.push({
                type: "featuredCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $(".pagination .page-numbers.current + .page-numbers").length > 0;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const params = [
            `story=${encodeURIComponent(titleQuery)}`,
            "s=",
            "type=comic",
        ];
        if (page > 1)
            params.push(`paged=${page}`);
        const url = `${BASE_URL}/?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $("ul.list-story.categories li").each((_, element) => {
            const parsed = this.parseListItem($, element);
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
        const hasNextPage = $("a.next").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const archive = $(".description-archive").first();
        const title = archive.find("h1").first().text().trim() || this.safeDecode(mangaId);
        const thumbnailUrl = this.absoluteUrl(archive.find("p img").first().attr("src") || "");
        const infoStrongs = archive.find(".b > p strong");
        const genre = infoStrongs.first().text().trim();
        const author = infoStrongs.length > 0
            ? infoStrongs.last().text().trim()
            : undefined;
        const synopsis = archive
            .find("#hidden-description")
            .first()
            .text()
            .trim();
        const tagGroups = [];
        if (genre) {
            const genres = genre
                .split(",")
                .map((g) => g.trim())
                .filter((g) => g.length > 0);
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
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: author || undefined,
                synopsis,
                contentRating: ContentRating.EVERYONE,
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
        const elements = $(".list-story a").toArray();
        elements.forEach((element, index) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const name = el.text().trim();
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name, elements.length - index),
                publishDate: this.parseYearDate(name),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("body img").each((_, element) => {
            const el = $(element);
            // Skip the logo image (inside div#logo).
            if (el.closest("div#logo").length > 0)
                return;
            const src = el.attr("src") || "";
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
    parseListItem($, element) {
        const el = $(element);
        const titleAnchor = el.find("a.cat-title").first();
        const href = titleAnchor.attr("href") || "";
        const title = titleAnchor.text().trim();
        if (!href || !title)
            return undefined;
        const imageUrl = this.absoluteUrl(el.find("img.book-cover").first().attr("src") || "");
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
        const match = name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : fallback;
    }
    parseYearDate(name) {
        // Chapter name often ends with "(YYYY)".
        const year = name.includes("(")
            ? name.substring(name.lastIndexOf("(") + 1).split(")")[0].trim()
            : "";
        if (/^\d{4}$/.test(year)) {
            const d = new Date(Number(year), 0, 1);
            if (!isNaN(d.getTime()))
                return d;
        }
        return new Date(0);
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
export const ReadAllComics = new ReadAllComicsExtension();
