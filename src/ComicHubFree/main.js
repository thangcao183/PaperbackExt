import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://comichubfree.com";
const MONTHS = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
};
class ComicHubFreeInterceptor extends PaperbackInterceptor {
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
export class ComicHubFreeExtension {
    requestManager = new ComicHubFreeInterceptor("main");
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
                title: "New Comics",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const path = section.id === "popular" ? "popular-comic" : "new-comic";
        const url = `${BASE_URL}/${path}?page=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $(".movie-list-index > .cartoon-box:has(.detail)").each((_, element) => {
            const el = $(element);
            const parsed = this.itemFromElement($, el);
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
        params.push(`key=${encodeURIComponent(titleQuery)}`);
        params.push(`page=${page}`);
        const url = `${BASE_URL}/search-comic?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $(".movie-list-index > .cartoon-box:has(.detail)").each((_, element) => {
            const el = $(element);
            const parsed = this.itemFromElement($, el);
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
        const hasNextPage = this.hasNextPage($);
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
        const title = el.find("h3").first().text().trim();
        if (!title)
            return undefined;
        const imageUrl = this.imageFromElement(el.find("img").first());
        return { mangaId, imageUrl, title };
    }
    hasNextPage($) {
        return $("ul.pagination a[rel=next]").not("[hidden]").length > 0;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const infoElement = $("div.movie-info").first();
        const seriesInfo = infoElement.find("div.series-info").first();
        const synopsis = infoElement.find("div#film-content").first().text().trim();
        const author = seriesInfo
            .find("dt:contains(Authors:) + dd")
            .first()
            .text()
            .trim();
        const statusText = seriesInfo
            .find("dt:contains(Status:) + dd")
            .first()
            .text()
            .trim();
        const thumbnailUrl = this.imageFromElement(seriesInfo.find("img").first());
        const title = infoElement.find("h1").first().text().trim() ||
            $("h1").first().text().trim() ||
            this.safeDecode(mangaId);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: author || undefined,
                synopsis,
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(statusText),
                tagGroups: [],
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const chapters = [];
        const seen = new Set();
        let url = this.mangaUrl(sourceManga.mangaId);
        while (url) {
            const $ = await this.fetchCheerio({ url, method: "GET" });
            $("div.episode-list > div > table > tbody > tr").each((_, element) => {
                const el = $(element);
                const link = el.find("a").first();
                const href = link.attr("href") || "";
                if (!href)
                    return;
                const chapterId = this.parsePath(href);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const name = link.text().trim();
                const dateText = el.find("td:last-of-type").first().text().trim();
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: name,
                    volume: 0,
                    chapNum: this.parseChapterNumber(name),
                    publishDate: this.parseDate(dateText),
                    langCode: "🇬🇧",
                });
            });
            const nextUrl = $("ul.pagination a[rel=next]")
                .not("[hidden]")
                .first()
                .attr("href");
            url = nextUrl ? this.absoluteUrl(nextUrl) : undefined;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = `${this.chapterUrl(chapter.chapterId)}/all`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const seen = new Set();
        $("img.chapter_img").each((_, element) => {
            const src = this.imageFromElement($(element));
            if (src && !seen.has(src)) {
                seen.add(src);
                pages.push(src);
            }
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
    // Upstream format: "d-MMM-yyyy" e.g. "5-Jan-2021"
    parseDate(text) {
        const m = text.match(/(\d{1,2})-([A-Za-z]{3,})-(\d{4})/);
        if (!m)
            return new Date(0);
        const day = parseInt(m[1], 10);
        const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
        const year = parseInt(m[3], 10);
        if (month === undefined || isNaN(day) || isNaN(year))
            return new Date(0);
        return new Date(year, month, day);
    }
    imageFromElement(img) {
        const src = img.attr("data-src") || img.attr("src") || "";
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
export const ComicHubFree = new ComicHubFreeExtension();
