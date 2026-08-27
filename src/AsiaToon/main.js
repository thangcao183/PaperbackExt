import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { AsiaToonSearchForm } from "./forms";
const BASE_URL = "https://asiatoon.net";
const GENRE_NAMES = new Set([
    "All",
    "Vanilla",
    "Monster Girls",
    "School Life",
    "Horror Thriller",
    "Slice of Life",
    "Supernatural",
    "New",
    "Office",
    "Sexy",
    "MILF",
    "In-Law",
    "Harem",
    "Cheating",
    "College",
    "Isekai",
    "UNCENSORED",
    "GL",
    "sexy comics",
    "Sci-fi",
    "Sports",
    "School life",
    "Historical",
    "Action",
    "Thriller",
    "Horror",
    "Fantasy",
    "Comedy",
    "Drama",
    "BL",
    "Romance",
]);
const BLOCKED_HEADINGS = new Set([
    "Log in",
    "Sign up",
    "Description",
    "Details",
    "Genres",
    "Tags",
    "Episodes Details",
]);
const MONTH_DATE_REGEX = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2},\s+\d{4}/;
class AsiaToonInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        // Age-gate cookie
        request.cookies = { ...request.cookies, hc_vfs: "Y" };
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
export class AsiaToonExtension {
    requestManager = new AsiaToonInterceptor("main");
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
        const page = metadata?.page ?? 1;
        const path = section.id === "latest" ? "en/genres/New" : "en/genres";
        const url = `${BASE_URL}/${path}?page=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const itemType = section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem";
        const items = [];
        const seen = new Set();
        $("article.component-item").each((_, element) => {
            const entry = this.mangaFromElement($, $(element));
            if (!entry || seen.has(entry.mangaId))
                return;
            seen.add(entry.mangaId);
            items.push({
                type: itemType,
                mangaId: entry.mangaId,
                imageUrl: entry.imageUrl,
                title: entry.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $(`a[href*='page=${page + 1}']`).length > 0;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getAdvancedSearchForm() {
        return new AsiaToonSearchForm();
    }
    async getSearchResults(query, metadata) {
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        if (titleQuery) {
            // Text search (single page)
            const url = `${BASE_URL}/en/search?keyword=${encodeURIComponent(titleQuery)}`;
            const $ = await this.fetchCheerio({ url, method: "GET" });
            const items = [];
            const seen = new Set();
            $("li.search-item-wrap").each((_, element) => {
                const entry = this.mangaFromElement($, $(element));
                if (!entry || seen.has(entry.mangaId))
                    return;
                seen.add(entry.mangaId);
                items.push({
                    mangaId: entry.mangaId,
                    imageUrl: entry.imageUrl,
                    title: entry.title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            });
            return { items, metadata: undefined };
        }
        const page = metadata?.page ?? 1;
        const browsePath = searchMeta?.browse?.[0] || "en/genres";
        const url = `${BASE_URL}/${browsePath}?page=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("article.component-item").each((_, element) => {
            const entry = this.mangaFromElement($, $(element));
            if (!entry || seen.has(entry.mangaId))
                return;
            seen.add(entry.mangaId);
            items.push({
                mangaId: entry.mangaId,
                imageUrl: entry.imageUrl,
                title: entry.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $(`a[href*='page=${page + 1}']`).length > 0;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    mangaFromElement($, element) {
        const anchor = element
            .find("a.thumb.js-thumbnail, a.thumb, a[href$='.html']")
            .first();
        if (anchor.length === 0)
            return undefined;
        const candidates = [
            anchor.attr("title") || "",
            element.find("[title]").first().attr("title") || "",
            element.find("p.line-clamp-3, p.webtoon-title").first().text() || "",
            element.find(".title").first().text() || "",
            element
                .find("img[alt]:not([alt=icon]):not([alt=img-thumb]):not([alt=wuf])")
                .first()
                .attr("alt") || "",
        ];
        const title = candidates.map((c) => c.trim()).find((c) => c.length > 0);
        if (!title)
            return undefined;
        const href = anchor.attr("href") || "";
        if (!href)
            return undefined;
        const imageUrl = this.imageFromElement($, anchor.find("img").first()) ||
            this.imageFromElement($, element.find("img").first());
        return {
            mangaId: this.parsePath(href),
            title,
            imageUrl,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $(".info__right h1, .info__right h2, h1, h2").first().text().trim() ||
            this.safeDecode(mangaId);
        let thumbnailUrl = this.imageFromElement($, $(".info__left .thumb-wrapper img, .thumb-wrapper a.thumb.js-thumbnail img, a.thumb.js-thumbnail img").first());
        if (thumbnailUrl.toLowerCase().startsWith("data:")) {
            thumbnailUrl = "";
        }
        const genreList = [];
        const genreSeen = new Set();
        $(".info__right a[href*='/en/genres/'], a[href*='/en/genres/']").each((_, element) => {
            const name = $(element).text().trim();
            if (GENRE_NAMES.has(name) && !genreSeen.has(name)) {
                genreSeen.add(name);
                genreList.push(name);
            }
        });
        const tagGroups = genreList.length > 0
            ? [
                {
                    id: "genres",
                    title: "Genres",
                    tags: genreList.map((g) => ({
                        id: g.toLowerCase().replace(/\s+/g, "-"),
                        title: g,
                    })),
                },
            ]
            : [];
        const synopsis = this.extractSectionText($, "Description") ||
            this.extractSectionText($, "Details") ||
            "";
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
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        const elements = $("a[href*='/episode-']").toArray();
        elements.forEach((element, index) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (seen.has(chapterId))
                return;
            seen.add(chapterId);
            const text = el.text().replace(/\s+/g, " ").trim();
            const dateMatch = text.match(MONTH_DATE_REGEX);
            const dateText = dateMatch ? dateMatch[0] : undefined;
            const name = (dateText ? text.split(dateText)[0] : text).trim() || text;
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name, elements.length - index),
                publishDate: this.parseDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("article.viewer__body img.content__img[data-index], article.js-episode-article img.content__img[data-index], .viewer__body img.content__img[data-index]").each((_, element) => {
            const el = $(element);
            const index = parseInt(el.attr("data-index") || "", 10);
            const src = this.imageFromElement($, el);
            if (src) {
                pages.push({ index: isNaN(index) ? Number.MAX_SAFE_INTEGER : index, url: src });
            }
        });
        pages.sort((a, b) => a.index - b.index);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: pages.map((p) => p.url),
        };
    }
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(mangaId);
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    extractSectionText($, heading) {
        let result;
        $("*").each((_, element) => {
            if (result)
                return;
            const el = $(element);
            const ownText = el.clone().children().remove().end().text().trim();
            if (ownText.toLowerCase() !== heading.toLowerCase())
                return;
            let sibling = el.next();
            while (sibling.length > 0) {
                const text = sibling.text().trim();
                if (text.length > 0 && !BLOCKED_HEADINGS.has(text)) {
                    result = text;
                    return;
                }
                sibling = sibling.next();
            }
        });
        return result;
    }
    imageFromElement($, img) {
        if (img.length === 0)
            return "";
        const raw = img.attr("data-src") || img.attr("data-original") || img.attr("src") || "";
        return this.absoluteUrl(raw);
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
    parseChapterNumber(name, fallback) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : fallback;
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date(0);
        const d = new Date(dateText.trim());
        return isNaN(d.getTime()) ? new Date(0) : d;
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
export const AsiaToon = new AsiaToonExtension();
