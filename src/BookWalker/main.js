import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://bookwalker.com";
class BookWalkerInterceptor extends PaperbackInterceptor {
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
export class BookWalkerExtension {
    requestManager = new BookWalkerInterceptor("main");
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
                title: "Popular Manga",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "New Releases",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const path = section.id === "popular"
            ? "/categories/2/?np=0&order=rate"
            : "/categories/2/?np=0&order=release";
        const url = `${BASE_URL}${path}&page=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        this.collectListings($).forEach((parsed) => {
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
        return {
            items,
            metadata: items.length > 0 ? { page: page + 1 } : undefined,
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
            `word=${encodeURIComponent(titleQuery)}`,
            "qcat=2",
            "np=0",
            `page=${page}`,
        ];
        const url = `${BASE_URL}/search/?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        this.collectListings($).forEach((parsed) => {
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
        return {
            items: results,
            metadata: results.length > 0 ? { page: page + 1 } : undefined,
        };
    }
    collectListings($) {
        const out = [];
        $("a[href*='/series/'], a[href*='/de/']").each((_, element) => {
            const parsed = this.itemFromLink($, $(element));
            if (parsed)
                out.push(parsed);
        });
        return out;
    }
    itemFromLink($, link) {
        const href = link.attr("href") || "";
        if (!href || !href.includes("/series/"))
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const img = link.find("img").first();
        const imageUrl = this.imageFromElement(img);
        const title = (link.attr("title") || "").trim() ||
            img.attr("alt")?.trim() ||
            link.text().trim();
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
        const title = $("h1").first().text().trim() ||
            $("meta[property='og:title']").attr("content")?.trim() ||
            this.safeDecode(mangaId);
        const synopsis = $("meta[property='og:description']").attr("content")?.trim() ||
            $("p").first().text().trim() ||
            "";
        const thumbnailUrl = this.absoluteUrl($("meta[property='og:image']").attr("content") || "") || this.imageFromElement($("img").first());
        const genres = $("a[href*='/categories/'], a[href*='/genre/']")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const tagGroups = [];
        if (genres.length > 0) {
            const uniq = Array.from(new Set(genres));
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: uniq.map((g) => ({
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
        // BookWalker serves its volume/chapter list through a protobuf gRPC API
        // (/api/kyon/kyon.v1.ContentService/Children) that cannot be decoded in the
        // Paperback runtime. We surface the series page itself as a single entry so
        // the extension stays usable for browsing/search; reading requires the app.
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "View on BookWalker",
                volume: 0,
                chapNum: 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        // Page images are delivered as E4P-encrypted manifests behind a login and
        // purchase wall, so no readable image URLs can be extracted publicly.
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: [],
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
    imageFromElement(img) {
        const src = img.attr("data-src") ||
            img.attr("data-original") ||
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
export const BookWalker = new BookWalkerExtension();
