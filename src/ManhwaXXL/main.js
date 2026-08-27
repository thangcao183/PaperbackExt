import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://hentaitnt.net";
class ManhwaXXLInterceptor extends PaperbackInterceptor {
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
export class ManhwaXXLExtension {
    requestManager = new ManhwaXXLInterceptor("main");
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
                id: "recommended",
                title: "Recommended",
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
        const base = section.id === "latest" ? "/latest" : "/recommended";
        const url = `${BASE_URL}${base}${page > 1 ? `/page/${page}` : ""}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $(".comic-card a").each((_, element) => {
            const parsed = this.itemFromElement($(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "recommended"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a[title=Next]").length > 0;
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
        let url;
        if (titleQuery.length > 0) {
            const path = page > 1 ? `/page/${page}` : "";
            url = `${BASE_URL}${path}?s=${encodeURIComponent(titleQuery)}`;
        }
        else {
            const path = page > 1 ? `/recommended/page/${page}` : "/recommended";
            url = `${BASE_URL}${path}`;
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $(".comic-card a").each((_, element) => {
            const parsed = this.itemFromElement($(element));
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
        const hasNextPage = $("a[title=Next]").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    itemFromElement(el) {
        const href = el.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = (el.attr("title") || "").trim();
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
        const author = $("i[title=Artists] + span a").first().text().trim() || undefined;
        const synopsis = $("#synopsisText").first().text().trim();
        const statusText = $("i[title=Status]").first().text().trim();
        const genres = $(".genre-item")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const thumbnailUrl = this.imageFromElement($(".comic-card img, .thumbnail img, img.cover").first());
        const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
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
                author,
                artist: author,
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
        const $details = await this.fetchCheerio({ url, method: "GET" });
        const postId = $details("#post_manga_id").first().attr("value") || "";
        if (!postId) {
            throw new Error("Failed to get chapter id");
        }
        const formParams = [
            ["action", "baka_ajax"],
            ["type", "load_chapters_paginated"],
            ["parent_id", postId],
            ["per_page", "10000"],
            ["order", "newest_first"],
        ];
        const body = formParams
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join("&");
        const [, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/wp-admin/admin-ajax.php`,
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
            },
            body,
        });
        const json = JSON.parse(Application.arrayBufferToUTF8String(data));
        const html = json.data?.html ?? "";
        const dom = htmlparser2.parseDocument(html);
        const $ = cheerio.load(dom);
        const chapters = [];
        const seen = new Set();
        $(".comic-card").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const isVip = el.find(".fa-crown").length > 0;
            const name = (isVip ? "🔒 " : "") + (link.attr("title") || "").trim();
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
                publishDate: new Date(0),
                langCode: "🇬🇧",
            });
        });
        return chapters.map((chapter, index) => ({
            ...chapter,
            chapNum: chapter.chapNum > 0 ? chapter.chapNum : chapters.length - index,
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $(".page-image").each((_, element) => {
            const src = $(element).attr("data-src") || $(element).attr("src") || "";
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
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("hiatus"))
            return "Hiatus";
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
export const ManhwaXXL = new ManhwaXXLExtension();
