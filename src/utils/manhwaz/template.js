import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, ManhwaZSettingsForm } from "./settings";
class ManhwaZInterceptor extends PaperbackInterceptor {
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
export class ManhwaZExtension {
    sourceName;
    defaultBaseUrl;
    authorHeading;
    statusHeading;
    popularGenrePath;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
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
        this.authorHeading = config.authorHeading ?? "author(s)";
        this.statusHeading = config.statusHeading ?? "status";
        this.popularGenrePath = config.popularGenrePath;
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new ManhwaZInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new ManhwaZSettingsForm(this.sourceName, this.defaultBaseUrl);
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
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, _metadata) {
        switch (section.id) {
            case "popular_section":
                return this.getPopularItems();
            case "latest_section":
                return this.getLatestItems();
            default:
                return { items: [] };
        }
    }
    async getPopularItems() {
        let url;
        let homepageSlider = true;
        if (this.popularGenrePath) {
            url = new URLBuilder(this.baseUrl)
                .addPath(this.popularGenrePath)
                .addQuery("m_orderby", "views")
                .addQuery("page", 1)
                .build();
            homepageSlider = false;
        }
        else {
            url = `${this.baseUrl}/`;
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        if (homepageSlider) {
            $("#slide-top > .item").each((_, element) => {
                const unit = $(element);
                const link = unit.find(".info-item a").first();
                const href = link.attr("href") || "";
                const title = link.text().trim();
                const mangaId = this.parseMangaId(href);
                const image = this.imageFromElement(unit.find(".img-item img").first());
                if (title && mangaId && !seen.has(mangaId)) {
                    seen.add(mangaId);
                    items.push({
                        type: "featuredCarouselItem",
                        mangaId,
                        imageUrl: image,
                        title,
                        metadata: undefined,
                    });
                }
            });
        }
        else {
            this.collectListItems($, ".page-item-detail", ".item-summary a", ".item-thumb img", seen, (mangaId, image, title) => items.push({
                type: "featuredCarouselItem",
                mangaId,
                imageUrl: image,
                title,
                metadata: undefined,
            }));
        }
        return { items, metadata: undefined };
    }
    async getLatestItems() {
        const url = `${this.baseUrl}/?page=1`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        this.collectListItems($, ".page-item-detail", ".item-summary a", ".item-thumb img", seen, (mangaId, image, title) => items.push({
            type: "simpleCarouselItem",
            mangaId,
            imageUrl: image,
            title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const titleQuery = (query.title || "").trim();
        const builder = new URLBuilder(this.baseUrl);
        if (titleQuery) {
            builder
                .addPath("search")
                .addQuery("s", encodeURIComponent(titleQuery))
                .addQuery("page", page);
        }
        else {
            // Browse all titles via the manga genre listing sorted by latest.
            builder.addQuery("page", page);
        }
        const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
        const results = [];
        const seen = new Set(collectedIds);
        this.collectListItems($, ".page-item-detail", ".item-summary a", ".item-thumb img", seen, (mangaId, image, title) => results.push({
            mangaId,
            imageUrl: image,
            title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = $("ul.pager a[rel=next]").length > 0;
        const reachedLimit = page >= ManhwaZExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedLimit
                ? { page: page + 1, collectedIds: [...seen] }
                : undefined,
        };
    }
    collectListItems($, itemSelector, linkSelector, imgSelector, seen, push) {
        $(itemSelector).each((_, element) => {
            const unit = $(element);
            const link = unit.find(linkSelector).first();
            const href = link.attr("href") || "";
            const title = link.text().trim();
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromElement(unit.find(imgSelector).first());
            if (!title || !mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            push(mangaId, image, title);
        });
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.getMangaShareUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("div.post-title h1").first().text().trim();
        const image = this.imageFromElement($("div.summary_image img").first());
        const description = $("div.summary__content").first().text().trim();
        const author = $(`div.summary-heading:contains(${this.authorHeading}) + div.summary-content`)
            .first()
            .text()
            .trim();
        const statusText = $(`div.summary-heading:contains(${this.statusHeading}) + div.summary-content`)
            .first()
            .text()
            .trim();
        const genres = [];
        $("div.genres-content a[rel=tag]").each((_, el) => {
            const g = $(el).text().trim();
            if (g)
                genres.push(g);
        });
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
                author: author || undefined,
                synopsis: description,
                contentRating: this.contentRating,
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
        const mangaUrl = this.getMangaShareUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        const chapters = [];
        const seen = new Set();
        $("li.wp-manga-chapter").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parseChapterId(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = link.text().trim();
            const dateText = el.find("span.chapter-release-date").first().text().trim();
            let chapNum = 0;
            const numMatch = name.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
            if (numMatch) {
                chapNum = parseFloat(numMatch[1]);
            }
            else {
                const anyNum = name.match(/(\d+(?:\.\d+)?)/);
                if (anyNum)
                    chapNum = parseFloat(anyNum[1]);
            }
            chapters.push({
                chapterId,
                sourceManga,
                title: name || `Chapter ${chapNum}`,
                volume: 0,
                chapNum,
                publishDate: this.parseDate(dateText),
                langCode: this.langCode,
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = new URLBuilder(this.baseUrl)
            .addPath(this.safeDecode(chapter.chapterId))
            .build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("div.page-break img").each((_, element) => {
            const image = this.imageFromElement($(element));
            if (image)
                pages.push(image);
        });
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: [...new Set(pages)],
        };
    }
    getMangaShareUrl(mangaId) {
        return new URLBuilder(this.baseUrl)
            .addPath(this.safeDecode(mangaId))
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    parseMangaId(href) {
        let cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
        cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
        cleaned = cleaned.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
        return this.toSafeId(cleaned);
    }
    parseChapterId(href) {
        let cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
        cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
        cleaned = cleaned.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
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
    imageFromElement(img) {
        if (!img || img.length === 0)
            return "";
        let src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            (img.attr("srcset") || "").split(" ")[0] ||
            img.attr("data-cfsrc") ||
            img.attr("src") ||
            "";
        src = src.trim().replace(/#.*$/, "");
        if (src && !src.startsWith("http")) {
            src = src.startsWith("/")
                ? `${this.baseUrl}${src}`
                : `${this.baseUrl}/${src}`;
        }
        return src;
    }
    parseStatus(status) {
        const s = status.toLowerCase().trim();
        if (!s)
            return "Unknown";
        if (s.includes("complet") || s.includes("hoàn thành") || s.includes("full"))
            return "Completed";
        if (s.includes("ongoing") || s.includes("đang ra"))
            return "Ongoing";
        if (s.includes("hiatus") || s.includes("hold"))
            return "Hiatus";
        if (s.includes("cancel") || s.includes("drop"))
            return "Cancelled";
        return "Unknown";
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date();
        const now = new Date();
        const lower = dateText.toLowerCase();
        if (lower.includes("ago")) {
            const amount = parseInt(lower.match(/\d+/)?.[0] || "0");
            if (lower.includes("sec"))
                return new Date(now.getTime() - amount * 1000);
            if (lower.includes("min"))
                return new Date(now.getTime() - amount * 60000);
            if (lower.includes("hour"))
                return new Date(now.getTime() - amount * 3600000);
            if (lower.includes("day"))
                return new Date(now.getTime() - amount * 86400000);
            if (lower.includes("week"))
                return new Date(now.getTime() - amount * 604800000);
            if (lower.includes("month"))
                return new Date(now.getTime() - amount * 2592000000);
            if (lower.includes("year"))
                return new Date(now.getTime() - amount * 31536000000);
            return now;
        }
        const direct = new Date(dateText);
        if (!isNaN(direct.getTime()))
            return direct;
        return now;
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
