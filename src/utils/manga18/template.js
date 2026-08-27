import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, Manga18SettingsForm } from "./settings";
class Manga18Interceptor extends PaperbackInterceptor {
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
export class Manga18Extension {
    sourceName;
    defaultBaseUrl;
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
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new Manga18Interceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new Manga18SettingsForm(this.sourceName, this.defaultBaseUrl);
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
        const builder = new URLBuilder(this.baseUrl)
            .addPath("list-manga")
            .addPath("1");
        if (section.id === "popular_section") {
            builder.addQuery("order_by", "views");
        }
        const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
        const items = [];
        const seen = new Set();
        const itemType = section.id === "popular_section"
            ? "featuredCarouselItem"
            : "simpleCarouselItem";
        $("div.story_item").each((_, element) => {
            const unit = $(element);
            const link = unit.find("div.mg_info > div.mg_name a").first();
            const href = unit.find("a").first().attr("href") || "";
            const title = link.text().trim();
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromElement(unit.find("img").first());
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
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const titleQuery = (query.title || "").trim();
        const builder = new URLBuilder(this.baseUrl)
            .addPath("list-manga")
            .addPath(`${page}`);
        if (titleQuery) {
            builder.addQuery("search", encodeURIComponent(titleQuery));
        }
        else {
            builder.addQuery("order_by", "views");
        }
        const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
        const results = [];
        const seen = new Set(collectedIds);
        $("div.story_item").each((_, element) => {
            const unit = $(element);
            const link = unit.find("div.mg_info > div.mg_name a").first();
            const href = unit.find("a").first().attr("href") || "";
            const title = link.text().trim();
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromElement(unit.find("img").first());
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
        const hasNextPage = $(".pagination > li:last-child:not(.active)").length > 0;
        const reachedLimit = page >= Manga18Extension.MAX_SEARCH_PAGES;
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
        const info = $("div.detail_listInfo");
        const title = $("div.detail_name > h1").first().text().trim();
        const image = this.imageFromElement($("div.detail_avatar > img").first());
        let description = $("div.detail_reviewContent").first().text().trim();
        const altName = this.infoValue(info, "Other name");
        if (altName && altName.toLowerCase() !== "updating") {
            description += `\n\nOther name: ${altName}`;
        }
        const author = this.infoValue(info, "author");
        const statusText = this.infoValue(info, "Status");
        const genres = [];
        $("div.info_value > a[href*='/manga-list/']").each((_, el) => {
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
                secondaryTitles: altName && altName.toLowerCase() !== "updating" ? [altName] : [],
                thumbnailUrl: image,
                author: author && author.toLowerCase() !== "updating" ? author : undefined,
                synopsis: description.trim(),
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
        const url = this.getMangaShareUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        $("div.chapter_box .item").each((_, element) => {
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
            const dateText = el.find("p").first().text().trim();
            let chapNum = 0;
            const numMatch = name.match(/(\d+(?:\.\d+)?)/);
            if (numMatch)
                chapNum = parseFloat(numMatch[1]);
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
        $("script").each((_, el) => {
            const html = $(el).html() || "";
            if (!html.includes("slides_p_path"))
                return;
            const start = html.indexOf("[");
            const end = html.indexOf("]", start);
            if (start === -1 || end === -1)
                return;
            const arrayContent = html.slice(start + 1, end);
            for (const raw of arrayContent.split(",")) {
                const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
                if (!cleaned)
                    continue;
                const decoded = this.base64ToString(cleaned);
                if (!decoded)
                    continue;
                pages.push(decoded.startsWith("/") ? `${this.baseUrl}${decoded}` : decoded);
            }
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
    infoValue(info, label) {
        const lower = label.toLowerCase();
        // Layout A: <div.info_label>Label</div><div.info_value>value</div>
        const byLabel = info
            .find(`div.info_label:contains(${label}) + div.info_value`)
            .first()
            .text()
            .trim();
        if (byLabel)
            return byLabel;
        // Layout B: <div.item> contains both label text and a div.info_value
        let value = "";
        info.find("div.item").each((_, el) => {
            const itemText = cheerioText(el);
            if (itemText.toLowerCase().includes(lower) && !value) {
                const v = cheerioFind(el, "div.info_value");
                if (v)
                    value = v;
            }
        });
        return value;
    }
    parseMangaId(href) {
        let cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
        cleaned = cleaned.replace(/^https?:\/\/[^/]+/, "");
        cleaned = cleaned.replace(/^\/+/, "");
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
    base64ToString(value) {
        try {
            const decoded = Application.base64Decode(value);
            if (typeof decoded === "string")
                return decoded;
            return Application.arrayBufferToUTF8String(decoded);
        }
        catch {
            return "";
        }
    }
    imageFromElement(img) {
        if (!img || img.length === 0)
            return "";
        let src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            img.attr("data-cfsrc") ||
            img.attr("src") ||
            "";
        src = src.trim();
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
        if (s.includes("complet"))
            return "Completed";
        if (s.includes("on going") || s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("hiatus"))
            return "Hiatus";
        if (s.includes("cancel"))
            return "Cancelled";
        return "Unknown";
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date();
        // Format dd-MM-yyyy
        const m = dateText.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
        if (m) {
            return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
        }
        const direct = new Date(dateText);
        if (!isNaN(direct.getTime()))
            return direct;
        return new Date();
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
// Small free helpers for the dual-layout info table parsing.
function cheerioText(el) {
    return cheerio.load(el).root().text().trim();
}
function cheerioFind(el, selector) {
    return cheerio.load(el)(selector).first().text().trim();
}
