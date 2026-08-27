import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { getBaseUrlOverride, EroMuseSettingsForm } from "./settings";
const NEXT_PAGE_SELECTOR = ".pagination span.current + span a";
const MAX_BROWSE_PAGES = 5;
const MAX_PAGE_FETCHES = 20;
const EIGHTMUSES_PROFILE = {
    albumSelector: "a.c-tile:has(img):not(:has(.members-only))",
    popularUrl: (b) => `${b}/comics/album/Various-Authors`,
    latestUrl: (b) => `${b}/comics/album/Various-Authors?sort=date`,
    searchUrl: (b, q) => `${b}/search?q=${encodeURIComponent(q)}&page=1`,
    linkedChapterSelector: "a.c-tile:has(img)[href*=/comics/album/]",
    pageThumbnailSelector: "a.c-tile:has(img)[href*=/comics/picture/] img",
    thumbSeg: "/th/",
    fullSeg: "/fl/",
    authorBreadcrumbAuthor: "div.top-menu-breadcrumb li:nth-child(2)",
    authorBreadcrumbVarious: "div.top-menu-breadcrumb li:nth-child(3)",
};
const EROFUS_PROFILE = {
    albumSelector: "a.a-click:has(img)",
    popularUrl: (b) => `${b}/comics/various-authors?sort=viewed&page=1`,
    latestUrl: (b) => `${b}/comics/various-authors?sort=recent&page=1`,
    searchUrl: (b, q) => `${b}/?search=${encodeURIComponent(q)}&page=1`,
    linkedChapterSelector: "a.a-click:has(img)[href^=/comics/]",
    pageThumbnailSelector: "a.a-click:has(img)[href*=/pic/] img",
    thumbSeg: "/thumb/",
    fullSeg: "/medium/",
    genreSelector: "div.album-tag-container a",
    authorBreadcrumbAuthor: "div.navigation-breadcrumb li:nth-child(3)",
    authorBreadcrumbVarious: "div.navigation-breadcrumb li:nth-child(5)",
};
class EroMuseInterceptor extends PaperbackInterceptor {
    getBaseUrl;
    constructor(id, getBaseUrl) {
        super(id);
        this.getBaseUrl = getBaseUrl;
    }
    async interceptRequest(request) {
        const baseUrl = this.getBaseUrl();
        request.headers = {
            ...request.headers,
            referer: `${baseUrl}/`,
            origin: baseUrl,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        return request;
    }
    async interceptResponse(request, response, data) {
        const cfMitigated = response.headers?.["cf-mitigated"];
        if (cfMitigated === "challenge") {
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
export class EroMuseExtension {
    sourceName;
    defaultBaseUrl;
    contentRating;
    langCode;
    profile;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    requestManager;
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 5,
        bufferInterval: 4,
        ignoreImages: true,
    });
    constructor(config) {
        this.sourceName = config.name;
        this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
        this.contentRating = config.contentRating ?? ContentRating.MATURE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.profile = this.defaultBaseUrl.includes("erofus")
            ? EROFUS_PROFILE
            : EIGHTMUSES_PROFILE;
        this.requestManager = new EroMuseInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new EroMuseSettingsForm(this.sourceName, this.defaultBaseUrl);
    }
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
                id: "popular_section",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest_section",
                title: "Latest",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        let url;
        if (meta?.nextUrl) {
            url = meta.nextUrl;
        }
        else if (section.id === "popular_section") {
            url = this.profile.popularUrl(this.baseUrl);
        }
        else if (section.id === "latest_section") {
            url = this.profile.latestUrl(this.baseUrl);
        }
        else {
            return { items: [] };
        }
        const itemType = section.id === "popular_section"
            ? "featuredCarouselItem"
            : "simpleCarouselItem";
        const { items, nextUrl, collectedIds } = await this.browse(url, meta?.collectedIds ?? []);
        const discoverItems = items.map((it) => ({
            type: itemType,
            mangaId: it.mangaId,
            imageUrl: it.imageUrl,
            title: it.title,
            metadata: undefined,
        }));
        return {
            items: discoverItems,
            metadata: nextUrl ? { nextUrl, collectedIds } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const titleQuery = (query.title || "").trim();
        let url;
        if (meta?.nextUrl) {
            url = meta.nextUrl;
        }
        else if (titleQuery) {
            url = this.profile.searchUrl(this.baseUrl, titleQuery);
        }
        else {
            url = this.profile.popularUrl(this.baseUrl);
        }
        const { items, nextUrl, collectedIds } = await this.browse(url, meta?.collectedIds ?? []);
        return {
            items,
            metadata: nextUrl ? { nextUrl, collectedIds } : undefined,
        };
    }
    /**
     * Fetch a listing page and collect album tiles as search results. Pagination
     * follows the EroMuse next-page link, recomputing the URL the same way the
     * Tachiyomi base class does.
     */
    async browse(url, collectedIds) {
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set(collectedIds);
        $(this.profile.albumSelector).each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const mangaId = this.parseId(href);
            if (!mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            const title = el.text().trim();
            const image = this.imageFromElement(el.find("img").first());
            items.push({
                mangaId,
                imageUrl: image,
                title: title || mangaId,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const reachedLimit = seen.size > MAX_BROWSE_PAGES * 60;
        const nextUrl = reachedLimit ? undefined : this.nextPageUrl($, url);
        return { items, nextUrl, collectedIds: [...seen] };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.absoluteUrl(this.safeDecode(mangaId));
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = this.titleFromId(mangaId);
        const image = this.imageFromElement($(`${this.profile.albumSelector} img`).first());
        const decoded = this.safeDecode(mangaId);
        const author = $(this.profile.authorBreadcrumbAuthor).first().text().trim() ||
            $(this.profile.authorBreadcrumbVarious).first().text().trim() ||
            undefined;
        const genres = [];
        if (this.profile.genreSelector) {
            $(this.profile.genreSelector).each((_, el) => {
                const g = $(el).text().trim();
                if (g)
                    genres.push(g);
            });
        }
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
                thumbnailUrl: image,
                author,
                synopsis: decoded.replace(/^\/+/, ""),
                contentRating: this.contentRating,
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
        const mangaId = sourceManga.mangaId;
        const url = this.absoluteUrl(this.safeDecode(mangaId));
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        // Linked sub-albums act as chapters.
        $(this.profile.linkedChapterSelector).each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parseId(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = el.text().trim();
            chapters.push({
                chapterId,
                sourceManga,
                title: name || "Chapter",
                volume: 0,
                chapNum: chapters.length + 1,
                publishDate: new Date(0),
                langCode: this.langCode,
            });
        });
        // If the album itself shows page thumbnails, add it as a self chapter.
        if ($(this.profile.pageThumbnailSelector).first().length > 0) {
            const selfId = this.parseId(url);
            if (selfId && !seen.has(selfId)) {
                seen.add(selfId);
                chapters.push({
                    chapterId: selfId,
                    sourceManga,
                    title: "Chapter",
                    volume: 0,
                    chapNum: chapters.length + 1,
                    publishDate: new Date(0),
                    langCode: this.langCode,
                });
            }
        }
        // Newest first, mirroring chapter list ordering.
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const startUrl = this.absoluteUrl(this.safeDecode(chapter.chapterId));
        const pages = [];
        const fetchBudget = { count: 0 };
        await this.collectPages(startUrl, pages, fetchBudget);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: [...new Set(pages)],
        };
    }
    /**
     * Recursively gather full-size page images from an album, descending into
     * nested sub-albums and following pagination, matching the EroMuse base
     * class. Bounded by a fetch budget to keep things safe.
     */
    async collectPages(url, pages, budget) {
        if (budget.count >= MAX_PAGE_FETCHES)
            return;
        budget.count++;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        // Nested chapters (folders) are visited first.
        const nestedUrls = [];
        $(this.profile.linkedChapterSelector).each((_, element) => {
            const href = $(element).attr("href") || "";
            if (href)
                nestedUrls.push(this.absoluteUrl(href));
        });
        $(this.profile.pageThumbnailSelector).each((_, element) => {
            const raw = this.imageFromElement($(element));
            if (raw) {
                pages.push(raw.replace(this.profile.thumbSeg, this.profile.fullSeg));
            }
        });
        const next = this.nextPageUrl($, url);
        if (next) {
            await this.collectPages(next, pages, budget);
        }
        for (const nested of nestedUrls) {
            await this.collectPages(nested, pages, budget);
        }
    }
    getMangaShareUrl(mangaId) {
        return this.absoluteUrl(this.safeDecode(mangaId));
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    /**
     * Recompute the next-page URL the way the EroMuse base class does: if the
     * current URL already has a page query parameter, bump it; otherwise append
     * the page number as a path segment (replacing a trailing numeric segment).
     */
    nextPageUrl($, currentUrl) {
        const text = $(NEXT_PAGE_SELECTOR).first().text().trim();
        const nextNum = parseInt(text, 10);
        if (!nextNum || isNaN(nextNum))
            return undefined;
        if (/[?&]page=\d+/.test(currentUrl)) {
            return currentUrl.replace(/([?&]page=)\d+/, `$1${nextNum}`);
        }
        // Split off any query string.
        const [path, queryPart] = this.splitQuery(currentUrl);
        const segments = path.replace(/\/+$/, "").split("/");
        const last = segments[segments.length - 1];
        if (/^\d+$/.test(last)) {
            segments[segments.length - 1] = String(nextNum);
        }
        else {
            segments.push(String(nextNum));
        }
        const rebuilt = segments.join("/");
        return queryPart ? `${rebuilt}?${queryPart}` : rebuilt;
    }
    splitQuery(url) {
        const idx = url.indexOf("?");
        if (idx === -1)
            return [url, ""];
        return [url.slice(0, idx), url.slice(idx + 1)];
    }
    parseId(href) {
        let cleaned = href.replace(/#.*$/, "");
        cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
        cleaned = cleaned.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
        cleaned = cleaned.replace(/\/$/, "");
        return this.toSafeId(cleaned);
    }
    absoluteUrl(idOrPath) {
        if (/^https?:\/\//.test(idOrPath))
            return idOrPath;
        const path = idOrPath.replace(/^\/+/, "");
        return `${this.baseUrl}/${path}`;
    }
    titleFromId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const last = decoded.replace(/\/+$/, "").split("/").pop() ?? decoded;
        return last.replace(/[-_]+/g, " ").trim() || decoded;
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
        if (!img || img.length === 0)
            return "";
        let src = img.attr("data-src") || img.attr("src") || "";
        src = src.trim().replace(/#.*$/, "");
        if (src && !src.startsWith("http")) {
            src = src.startsWith("/")
                ? `${this.baseUrl}${src}`
                : `${this.baseUrl}/${src}`;
        }
        return src;
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
