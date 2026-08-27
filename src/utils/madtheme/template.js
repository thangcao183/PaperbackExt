import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, MadThemeSettingsForm } from "./settings";
import { MadThemeSearchForm, ORDER_BY_OPTIONS, } from "./forms";
const MANGA_ID_REGEX = /\/manga\/(\d+)-/;
class MadThemeInterceptor extends PaperbackInterceptor {
    getBaseUrl;
    constructor(id, getBaseUrl) {
        super(id);
        this.getBaseUrl = getBaseUrl;
    }
    async interceptRequest(request) {
        const baseUrl = this.getBaseUrl();
        const isImage = MadThemeInterceptor.isImageRequest(request.url);
        request.headers = {
            ...request.headers,
            referer: `${baseUrl}/`,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: isImage
                ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
                : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        // Image CDNs (e.g. KaliScan's s11.1stmggv7.xyz) use nginx hotlink
        // protection that 403s on an anomalous `Origin` header - real browsers
        // never send Origin when loading <img> tags. Only set Origin on
        // non-image (XHR/fetch/document) requests.
        if (!isImage) {
            request.headers["origin"] = baseUrl;
        }
        else {
            delete request.headers["origin"];
        }
        return request;
    }
    static isImageRequest(url) {
        return /\.(jpe?g|png|webp|gif|avif|bmp|svg|apng)(\?|#|$)/i.test(url);
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
export class MadThemeExtension {
    sourceName;
    defaultBaseUrl;
    contentRating;
    langCode;
    useLegacyApi;
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
        this.useLegacyApi = config.useLegacyApi ?? false;
        this.requestManager = new MadThemeInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new MadThemeSettingsForm(this.sourceName, this.defaultBaseUrl);
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
                return this.getListItems("views", "featuredCarouselItem");
            case "latest_section":
                return this.getListItems("updated_at", "simpleCarouselItem");
            default:
                return { items: [] };
        }
    }
    async getListItems(sort, itemType) {
        const url = new URLBuilder(this.baseUrl)
            .addPath("search")
            .addQuery("sort", sort)
            .addQuery("page", 1)
            .build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $(".book-detailed-item").each((_, element) => {
            const unit = $(element);
            const link = unit.find("a").first();
            const href = link.attr("href") || "";
            const title = (link.attr("title") || link.text()).trim();
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
    async getSortingOptions() {
        return ORDER_BY_OPTIONS.map((o) => ({ id: o.id, label: o.title }));
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata
            ?.searchMeta;
        return new MadThemeSearchForm(meta);
    }
    async getSearchResults(query, metadata, sortingOption) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        const sortId = sortingOption?.id ?? "";
        const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
        const effectiveOrderBy = sortId || filterOrderBy;
        const status = searchMeta?.status?.[0] ?? "";
        const builder = new URLBuilder(this.baseUrl)
            .addPath("search")
            .addQuery("q", encodeURIComponent(titleQuery))
            .addQuery("page", page);
        if (effectiveOrderBy)
            builder.addQuery("sort", effectiveOrderBy);
        if (status)
            builder.addQuery("status", status);
        const $ = await this.fetchCheerio({ url: builder.build(), method: "GET" });
        const results = [];
        const seen = new Set(collectedIds);
        $(".book-detailed-item").each((_, element) => {
            const unit = $(element);
            const link = unit.find("a").first();
            const href = link.attr("href") || "";
            const title = (link.attr("title") || link.text()).trim();
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
        const hasNextPage = $(".paginator > a.active + a:not([rel=next])").length > 0;
        const reachedLimit = page >= MadThemeExtension.MAX_SEARCH_PAGES;
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
        const title = $(".detail h1").first().text().trim();
        const image = this.imageFromElement($("#cover img").first());
        const altNames = $(".detail h2")
            .first()
            .text()
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        let description = $(".summary .content, .summary .content ~ p")
            .map((_, el) => $(el).text().trim())
            .get()
            .join("\n")
            .trim();
        if (altNames.length > 0) {
            description += `\n\nAlternative Names: ${altNames.join(", ")}`;
        }
        const author = $(".detail .meta > p > strong:contains(Authors) ~ a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((s) => s.length > 0)
            .join(", ");
        const statusText = $(".detail .meta > p > strong:contains(Status) ~ a")
            .first()
            .text()
            .trim();
        const genres = [];
        $(".detail .meta > p > strong:contains(Genres) ~ a").each((_, el) => {
            const g = $(el).text().trim().replace(/[,;]+$/, "").trim();
            if (g)
                genres.push(g);
        });
        const tagGroups = [];
        if (genres.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genres.map((g) => ({
                    id: this.slugifyTag(g),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: altNames,
                thumbnailUrl: image,
                author: author || undefined,
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
        const mangaId = sourceManga.mangaId;
        const mangaUrl = this.getMangaShareUrl(mangaId);
        const decoded = this.safeDecode(mangaId);
        const numericIdMatch = decoded.match(/(\d+)-/) || mangaUrl.match(MANGA_ID_REGEX);
        let $;
        if (this.useLegacyApi && numericIdMatch) {
            // Legacy sites (e.g. KaliScan) serve chapters from a backend endpoint;
            // the modern /api/manga/{id}/chapters path returns only the page shell.
            // Note: manga_id alone is sufficient; manga_name is omitted because the
            // URLBuilder does not URL-encode values and a raw space breaks the query.
            const numericId = numericIdMatch[1];
            // The trailing slash after `chaplist` is REQUIRED: without it the server
            // returns the 83KB page shell (0 chapters); with it the ~13KB chapter-list
            // fragment is returned. URLBuilder does not emit a trailing slash before
            // the query string, so build this URL directly.
            const apiUrl = `${this.baseUrl}/service/backend/chaplist/?manga_id=${numericId}`;
            $ = await this.fetchCheerio({ url: apiUrl, method: "GET" });
        }
        else if (numericIdMatch) {
            const numericId = numericIdMatch[1];
            const apiUrl = new URLBuilder(this.baseUrl)
                .addPath("api")
                .addPath("manga")
                .addPath(numericId)
                .addPath("chapters")
                .addQuery("source", "detail")
                .build();
            $ = await this.fetchCheerio({ url: apiUrl, method: "GET" });
        }
        else {
            $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        }
        const chapters = [];
        const seen = new Set();
        $("#chapter-list > li").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parseChapterId(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = el.find(".chapter-title").first().text().trim();
            const dateText = el.find(".chapter-update").first().text().trim();
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
        $("#chapter-images img, .chapter-image[data-src]").each((_, element) => {
            const image = this.imageFromElement($(element));
            if (image)
                pages.push(image);
        });
        // Fallback: var chapImages='url1,url2';
        if (pages.length === 0) {
            $("script").each((_, el) => {
                const html = $(el).html() || "";
                const match = html.match(/var\s+chapImages\s*=\s*['"]([^'"]+)['"]/);
                if (match) {
                    for (const part of match[1].split(",")) {
                        // Cheerio's .html() re-encodes `&` inside <script> as `&amp;`,
                        // which corrupts the CDN's signed query (?acc=...&expires=...)
                        // and triggers a 403. Decode entities back before requesting.
                        const p = this.decodeHtmlEntities(part.trim());
                        if (p)
                            pages.push(p.startsWith("http") ? p : `${this.baseUrl}/${p}`);
                    }
                }
            });
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: [...new Set(pages)],
        };
    }
    getMangaShareUrl(mangaId) {
        return new URLBuilder(this.baseUrl)
            .addPath("manga")
            .addPath(this.safeDecode(mangaId))
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    parseMangaId(href) {
        const marker = "/manga/";
        const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
        const idx = cleaned.indexOf(marker);
        if (idx !== -1) {
            return this.toSafeId(cleaned.slice(idx + marker.length).split("/")[0]);
        }
        return this.toSafeId(cleaned.split("/").pop() ?? "");
    }
    parseChapterId(href) {
        // Strip scheme + host so the stored ID is a site-relative path.
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
    decodeHtmlEntities(text) {
        // Cheerio's .html() serialization escapes `&` -> `&amp;` (and other
        // entities) inside <script> bodies. Signed CDN URLs use `&` to join
        // query params, so the escaped form breaks the signature. Decode the
        // common entities back to their literal characters.
        return text
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'")
            .replace(/&#x27;/gi, "'")
            .replace(/&apos;/g, "'");
    }
    slugifyTag(text) {
        // Paperback tag IDs must be alphanumeric or contain only
        // ._-@()[]%?#+=/&: — strip anything else (e.g. trailing commas).
        return text
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]/g, "")
            .replace(/^-+|-+$/g, "");
    }
    imageFromElement(img) {
        if (!img || img.length === 0)
            return "";
        let src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
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
        if (s.includes("complet"))
            return "Completed";
        if (s.includes("ongoing") || s.includes("on going"))
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
