import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, MangaReaderSettingsForm } from "./settings";
import { MangaReaderSearchForm, SORT_OPTIONS, } from "./forms";
class MangaReaderInterceptor extends PaperbackInterceptor {
    getBaseUrl;
    constructor(id, getBaseUrl) {
        super(id);
        this.getBaseUrl = getBaseUrl;
    }
    static hostOf(url) {
        // Strip scheme, then take everything before the first /, ? or #.
        const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
        return withoutScheme.split(/[/?#]/, 1)[0]?.toLowerCase() ?? "";
    }
    async interceptRequest(request) {
        const baseUrl = this.getBaseUrl();
        request.headers = {
            ...request.headers,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        // Only attach the site referer/origin for same-host requests. Page images
        // are frequently hotlinked to foreign CDNs whose Cloudflare hotlink
        // protection returns 403 when a cross-site referer/origin is present.
        const baseHost = MangaReaderInterceptor.hostOf(baseUrl);
        const requestHost = MangaReaderInterceptor.hostOf(request.url);
        if (baseHost && requestHost === baseHost) {
            request.headers = {
                ...request.headers,
                referer: `${baseUrl}/`,
                origin: baseUrl,
            };
        }
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
export class MangaReaderExtension {
    sourceName;
    defaultBaseUrl;
    pageListSelector;
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
        this.pageListSelector =
            config.pageListSelector ?? ".container-reader-chapter > div > img";
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new MangaReaderInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new MangaReaderSettingsForm(this.sourceName, this.defaultBaseUrl);
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
                return this.getListItems("most-viewed", "featuredCarouselItem");
            case "latest_section":
                return this.getListItems("latest-updated", "simpleCarouselItem");
            default:
                return { items: [] };
        }
    }
    async getListItems(sort, itemType) {
        const url = new URLBuilder(this.baseUrl)
            .addPath("filter")
            .addQuery("sort", sort)
            .addQuery("page", 1)
            .build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $(".manga_list-sbs .manga-poster").each((_, element) => {
            const link = $(element);
            const href = link.attr("href") || "";
            const img = link.find("img").first();
            const title = (img.attr("alt") || "").trim();
            const mangaId = this.parsePath(href);
            const image = this.imageFromElement(img);
            if (title && mangaId && !seen.has(mangaId)) {
                seen.add(mangaId);
                items.push({
                    type: itemType,
                    mangaId,
                    imageUrl: image,
                    title,
                    metadata: undefined,
                });
            }
        });
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSortingOptions() {
        return SORT_OPTIONS.map((o) => ({ id: o.id, label: o.title }));
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata
            ?.searchMeta;
        return new MangaReaderSearchForm(meta);
    }
    async getSearchResults(query, metadata, sortingOption) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        const sortId = sortingOption?.id ?? "";
        const filterSort = searchMeta?.sort?.[0] ?? "";
        let builder;
        if (titleQuery) {
            builder = new URLBuilder(this.baseUrl)
                .addPath("search")
                .addQuery("keyword", titleQuery)
                .addQuery("page", page);
        }
        else {
            builder = new URLBuilder(this.baseUrl)
                .addPath("filter")
                .addQuery("sort", sortId || filterSort || "most-viewed")
                .addQuery("page", page);
        }
        const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
        const results = [];
        const seen = new Set(collectedIds);
        $(".manga_list-sbs .manga-poster").each((_, element) => {
            const link = $(element);
            const href = link.attr("href") || "";
            const img = link.find("img").first();
            const title = (img.attr("alt") || "").trim();
            const mangaId = this.parsePath(href);
            const image = this.imageFromElement(img);
            if (!title || !mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            results.push({
                mangaId,
                imageUrl: image,
                title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("ul.pagination > li.active + li").length > 0;
        const reachedLimit = page >= MangaReaderExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedLimit
                ? { page: page + 1, collectedIds: [...seen] }
                : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.getMangaShareUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const detail = $("#ani_detail").first();
        const title = detail.find(".manga-name").first().contents().filter((_, n) => n.type === "text").text().trim()
            || detail.find(".manga-name").first().text().trim();
        const image = this.imageFromElement(detail.find("img").first());
        const genres = [];
        detail.find(".genres > a").each((_, el) => {
            const g = $(el).text().trim();
            if (g)
                genres.push(g);
        });
        const altTitle = detail.find(".manga-name-or").first().text().trim();
        let description = detail.find(".description").first().text().trim();
        if (altTitle && altTitle !== title) {
            description += `\n\nAlternative Title: ${altTitle}`;
        }
        description = description.trim();
        let author;
        let artist;
        let statusText = "";
        detail.find(".anisc-info > .item").each((_, item) => {
            const head = $(item).find(".item-head").first().text().trim();
            if (head === "Authors:") {
                const names = [];
                $(item)
                    .find(".name")
                    .each((_, n) => {
                    const t = $(n).text().replace(/,/g, "").trim();
                    if (t)
                        names.push(t);
                });
                if (names.length > 0)
                    author = names.join(", ");
            }
            else if (head === "Status:") {
                statusText = $(item).find(".name").first().text().trim();
            }
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
                secondaryTitles: altTitle && altTitle !== title ? [altTitle] : [],
                thumbnailUrl: image,
                author,
                artist,
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
        const elements = $("#en-chapters > li.chapter-item").toArray();
        elements.forEach((element, index) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const dataId = el.attr("data-id") || "";
            const path = this.stripDomain(href);
            const chapterId = this.toSafeId(`${path}#${dataId}`);
            if (seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = el.find(".name").first().text().trim() || link.text().trim();
            let chapNum = -1;
            const numMatch = name.match(/(\d+(?:\.\d+)?)/);
            if (numMatch) {
                chapNum = parseFloat(numMatch[1]);
            }
            else {
                chapNum = elements.length - index;
            }
            chapters.push({
                chapterId,
                sourceManga,
                title: name || `Chapter ${chapNum}`,
                volume: 0,
                chapNum,
                publishDate: new Date(0),
                langCode: this.langCode,
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const hashIdx = decoded.lastIndexOf("#");
        const chapterPath = hashIdx !== -1 ? decoded.slice(0, hashIdx) : decoded;
        let readingId = hashIdx !== -1 ? decoded.slice(hashIdx + 1) : "";
        // Resolve the reading id from the chapter page if not embedded.
        if (!readingId) {
            const chapterUrl = `${this.baseUrl}${chapterPath.startsWith("/") ? "" : "/"}${chapterPath}`;
            const $page = await this.fetchCheerio({ url: chapterUrl, method: "GET" });
            readingId = $page("div[data-reading-id]").first().attr("data-reading-id") || "";
            if (!readingId) {
                throw new Error("Unable to retrieve chapter id");
            }
        }
        const chapterShareUrl = `${this.baseUrl}${chapterPath.startsWith("/") ? "" : "/"}${chapterPath}`;
        const ajaxUrl = `${this.baseUrl}//ajax/image/list/${readingId}?mode=vertical`;
        const json = await this.fetchJson({
            url: ajaxUrl,
            method: "GET",
            headers: {
                accept: "application/json, text/javascript, */*; q=0.01",
                referer: encodeURIComponent(chapterShareUrl),
                "x-requested-with": "XMLHttpRequest",
            },
        });
        const $ = cheerio.load(htmlparser2.parseDocument(json.html || ""));
        const pages = [];
        $(this.pageListSelector).each((_, element) => {
            let image = this.imageFromElement($(element));
            if (!image) {
                image = this.imageFromElement($(element).find("img").first());
            }
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
        const path = this.safeDecode(mangaId);
        return `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    stripDomain(href) {
        let cleaned = href.replace(/[?#].*$/, "");
        cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
        if (!cleaned.startsWith("/"))
            cleaned = `/${cleaned}`;
        return cleaned.replace(/\/+$/, "");
    }
    parsePath(href) {
        return this.toSafeId(this.stripDomain(href));
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
        let src = img.attr("data-lazy-src") ||
            img.attr("data-src") ||
            img.attr("data-url") ||
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
        if (s.includes("ongoing") ||
            s.includes("publishing") ||
            s.includes("releasing"))
            return "Ongoing";
        if (s.includes("completed") || s.includes("finished"))
            return "Completed";
        if (s.includes("hiatus") || s.includes("hold"))
            return "Hiatus";
        if (s.includes("cancel") || s.includes("discontinued"))
            return "Cancelled";
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
}
