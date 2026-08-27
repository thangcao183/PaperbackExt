import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://gensura.net";
const ADV_SEARCH_URL = `${BASE_URL}/advanced-search`;
class GensuraInterceptor extends PaperbackInterceptor {
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
export class GensuraExtension {
    requestManager = new GensuraInterceptor("main");
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
                title: "Latest",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        // Popular -> sort=1, Latest -> sort=2
        const sort = section.id === "popular" ? "1" : "2";
        const url = `${ADV_SEARCH_URL}/?search=1&type=0&sort=${sort}&page=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("a[href^='/manga/']").each((_, element) => {
            const el = $(element);
            const parsed = this.itemFromElement($, el);
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
        const params = [];
        params.push("search=1");
        params.push("type=0");
        params.push("sort=0");
        params.push(`name=${encodeURIComponent(titleQuery)}`);
        if (page > 1)
            params.push(`page=${page}`);
        const url = `${ADV_SEARCH_URL}/?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $("a[href^='/manga/']").each((_, element) => {
            const el = $(element);
            const parsed = this.itemFromElement($, el);
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
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
        const title = el.find("h2").first().text().trim();
        const imageUrl = this.imageFromElement(el.find("img").first());
        if (!title || !imageUrl)
            return undefined;
        return { mangaId, imageUrl, title };
    }
    hasNextPage($) {
        // Upstream: a[href*=page] with blank text indicates a next-page control
        let found = false;
        $("a[href*=page]").each((_, element) => {
            if (($(element).text() || "").trim() === "")
                found = true;
        });
        return found;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const authors = this.eachText($, "a[href*='/circles/']").join(", ");
        const artists = this.eachText($, "a[href*='/authors/']").join(", ");
        const titlesRaw = $("h1.font-semibold").first().text().trim();
        const titles = titlesRaw.split(" | ");
        const altTitle = $("h2.text-lg.font-medium").first().text().trim();
        const primaryTitle = titles[0]?.trim() || this.safeDecode(mangaId);
        const secondaryTitles = [];
        if (titles[1])
            secondaryTitles.push(titles[1].trim());
        if (altTitle)
            secondaryTitles.push(altTitle);
        const genres = this.eachText($, "a[href*='/tags/']");
        const categories = this.eachText($, "a[href*='/categories/']");
        const parodies = this.eachText($, "a[href*='/parodies/']");
        const circles = this.eachText($, "a[href*='/circles/']");
        const synopsis = this.buildSynopsis(secondaryTitles, categories, parodies, circles);
        const thumbnailUrl = this.imageFromElement($("img[src*=thumbnail].w-96").first());
        const tagGroups = [];
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
                primaryTitle,
                secondaryTitles,
                thumbnailUrl,
                author: authors || artists,
                artist: artists,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: "Completed",
                tagGroups,
                shareUrl: url,
            },
        };
    }
    buildSynopsis(secondaryTitles, categories, parodies, circles) {
        const lines = [];
        if (secondaryTitles.length > 0) {
            lines.push("Alternative Titles:");
            for (const t of secondaryTitles)
                lines.push(`- ${t}`);
            lines.push("");
        }
        lines.push(`Categories: ${categories.join(" ")}`);
        lines.push(`Parodies: ${parodies.join(" ")}`);
        lines.push(`Circles: ${circles.join(" ")}`);
        return lines.join("\n").trim();
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        // Upstream models the whole gallery as a single "Chapter" pointing at the
        // manga URL itself.
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter",
                volume: 0,
                chapNum: 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("img[src*=images]:not(img[src*=thumbnail]).w-full, img[data-src*=images]").each((_, element) => {
            const el = $(element);
            const src = el.attr("src") || el.attr("data-src") || "";
            if (!src)
                return;
            // Strip the "-t" thumbnail suffix before the extension.
            const full = this.absoluteUrl(src).replace(/-t(?=\.)/, "");
            pages.push(full);
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
    eachText($, selector) {
        return $(selector)
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0);
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
    imageFromElement(img) {
        const src = img.attr("src") ||
            img.attr("data-src") ||
            img.attr("data-lazy-src") ||
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
export const Gensura = new GensuraExtension();
