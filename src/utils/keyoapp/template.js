import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { getBaseUrlOverride, getShowPaidChapters, KeyoappSettingsForm, } from "./settings";
class KeyoappInterceptor extends PaperbackInterceptor {
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
export class KeyoappExtension {
    sourceName;
    defaultBaseUrl;
    contentRating;
    langCode;
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
        this.requestManager = new KeyoappInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new KeyoappSettingsForm(this.sourceName, this.defaultBaseUrl);
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
                return this.getPopularItems("featuredCarouselItem");
            case "latest_section":
                return this.getLatestItems("simpleCarouselItem");
            default:
                return { items: [] };
        }
    }
    async getPopularItems(itemType) {
        const $ = await this.fetchCheerio({ url: this.baseUrl, method: "GET" });
        const items = [];
        const seen = new Set();
        // The homepage lists popular/trending under a heading.
        const selector = "div:contains(Popular) + div .group.overflow-hidden.grid, " +
            "div:contains(Trending) + div .group.overflow-hidden.grid, " +
            "div:contains(Popularie) + div .group.overflow-hidden.grid";
        $(selector).each((_, element) => {
            const unit = $(element);
            const link = unit.find("a[href]").first();
            const href = link.attr("href") || "";
            const title = (link.attr("title") || link.text()).trim();
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromStyle(unit, "*[style*=background-image]");
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
    async getLatestItems(itemType) {
        const url = `${this.baseUrl}/latest/`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("div.grid > div.group").each((_, element) => {
            const unit = $(element);
            const link = unit.find("a[href]").first();
            const href = link.attr("href") || "";
            const title = (link.attr("title") || link.text()).trim();
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromStyle(unit, "*[style*=background-image]");
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
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim();
        // Keyoapp's /series/ page lists every series; search is performed
        // client-side by filtering on the title attribute. The trailing slash
        // is required to avoid a 301 redirect to an http:// URL (ATS -1022).
        const url = `${this.baseUrl}/series/?q=${encodeURIComponent(titleQuery)}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        const lowerQuery = titleQuery.toLowerCase();
        $("#searched_series_page > button").each((_, element) => {
            const unit = $(element);
            const link = unit.find("a[href]").first();
            const href = link.attr("href") || "";
            const title = (unit.attr("title") ||
                link.attr("title") ||
                link.text()).trim();
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromStyle(unit, "*[style*=background-image]");
            if (!title || !mangaId)
                return;
            if (lowerQuery && !title.toLowerCase().includes(lowerQuery))
                return;
            if (seen.has(mangaId))
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
        return { items: results, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.getMangaShareUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("div.grid > h1").first().text().trim();
        const image = this.imageFromStyle($("html"), "div[class*=photoURL]");
        // Keyoapp uses ":containsOwn" in jsoup; cheerio only has ":contains".
        const synopsis = $("#expand_content p").first().text().trim();
        const altNames = [];
        $("div.font-medium:contains(Alternative titles) ~ div span").each((_, el) => {
            const t = $(el).text().trim();
            if (t && t !== "No alternative titles.")
                altNames.push(t);
        });
        let description = synopsis;
        if (altNames.length > 0) {
            if (description)
                description += "\n\n";
            description +=
                "Alternative Titles:\n" + altNames.map((t) => `- ${t}`).join("\n");
        }
        const statusText = $("div:has(span:contains(Status)) ~ div")
            .first()
            .text()
            .trim();
        const author = this.cleanField($("div:has(span:contains(Author)) ~ div").first().text().trim());
        const artist = this.cleanField($("div:has(span:contains(Artist)) ~ div").first().text().trim());
        const type = $("div:has(span:contains(Type)) ~ div").first().text().trim();
        const genres = [];
        if (type)
            genres.push(this.titleCase(type));
        $("div.grid:has(>h1) > div > a:not([title='Status'])").each((_, el) => {
            const g = $(el).text().trim().replace(/,$/, "");
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
                secondaryTitles: altNames,
                thumbnailUrl: image,
                author: author || undefined,
                artist: artist || undefined,
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
        const mangaId = sourceManga.mangaId;
        const url = this.getMangaShareUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const showPaid = getShowPaidChapters(this.sourceName);
        $("#chapters > a").each((_, element) => {
            const el = $(element);
            // Skip upcoming chapters.
            if (el.find(".text-sm span").text().toLowerCase().includes("upcoming")) {
                return;
            }
            const isPaid = el.find("img[alt~='Coin']").length > 0;
            if (isPaid && !showPaid)
                return;
            const href = el.is("a[href]")
                ? el.attr("href") || ""
                : el.find("a[href]").first().attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parseChapterId(href);
            if (!chapterId)
                return;
            let chapterTitle = el.find(".text-sm").first().text().trim();
            if (!chapterTitle)
                chapterTitle = el.text().trim();
            if (isPaid)
                chapterTitle = `🔒 ${chapterTitle}`;
            let chapNum = 0;
            const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
            if (numMatch) {
                chapNum = parseFloat(numMatch[1]);
            }
            else {
                const anyNum = chapterTitle.match(/(\d+(?:\.\d+)?)/);
                if (anyNum)
                    chapNum = parseFloat(anyNum[1]);
            }
            const dateText = el.find(".text-xs").first().text().trim();
            const publishDate = this.parseDate(dateText);
            chapters.push({
                chapterId,
                sourceManga,
                title: chapterTitle,
                volume: 0,
                chapNum,
                publishDate,
                langCode: this.langCode,
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        // Keyoapp's canonical chapter URLs end in a trailing slash. Requesting
        // without it triggers a 301 redirect whose Location uses http://, which
        // iOS App Transport Security refuses to follow (NSURLError -1022).
        const url = `${this.baseUrl}/${chapter.chapterId}/`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const cdnUrl = this.getCdnUrl($);
        if (cdnUrl) {
            $("#pages > img").each((_, element) => {
                const uid = ($(element).attr("uid") || "").trim();
                if (uid)
                    pages.push(`${cdnUrl}/${uid}`);
            });
        }
        // Fallback: old method reads the image src directly.
        if (pages.length === 0) {
            $("#pages > img").each((_, element) => {
                const image = this.imageFromElement($(element));
                if (image && /cdn\d*\.keyoapp\.com/.test(image))
                    pages.push(image);
            });
        }
        const uniquePages = [...new Set(pages)];
        // Returning an empty page list crashes the Paperback reader. Throw a
        // clear error instead (e.g. the chapter page is JS-rendered/locked or
        // the CDN host script was not found).
        if (uniquePages.length === 0) {
            throw new Error("No pages found for this chapter");
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: uniquePages,
        };
    }
    getMangaShareUrl(mangaId) {
        // Keyoapp's canonical series URLs end in a trailing slash. Requesting
        // without it triggers a 301 redirect whose Location uses http://, which
        // iOS App Transport Security refuses to follow (NSURLError -1022).
        return `${this.baseUrl}/series/${mangaId}/`;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    getCdnUrl($) {
        const cdnHostRegex = /realUrl\s*=\s*`[^`]+\/\/([^/]+)/;
        const cleanRegex = /\$\{[^}]*\}/g;
        let cdnUrl;
        $("script").each((_, el) => {
            if (cdnUrl)
                return;
            const html = $(el).html() || "";
            const match = html.match(cdnHostRegex);
            if (match) {
                const host = match[1].replace(cleanRegex, "");
                cdnUrl = `https://${host}/uploads`;
            }
        });
        return cdnUrl;
    }
    parseMangaId(href) {
        const marker = "/series/";
        const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
        const idx = cleaned.indexOf(marker);
        if (idx !== -1) {
            return this.toSafeId(cleaned.slice(idx + marker.length).split("/")[0]);
        }
        return this.toSafeId(cleaned.split("/").pop() ?? "");
    }
    parseChapterId(href) {
        // Keyoapp chapter URLs used to be flat ({baseUrl}/{chapter-slug}/) but
        // newer deployments serve them under a /chapter/ prefix
        // ({baseUrl}/chapter/{chapter-slug}/). Requesting the flat URL on those
        // sites silently falls back to the series page (which has #chapters but
        // no #pages) -> "No pages found". Preserve the FULL path (minus domain)
        // so the exact reader URL is reproduced, mirroring keiyoushi's
        // setUrlWithoutDomain. The charset allows "/", so toSafeId keeps it.
        const cleaned = href
            .replace(/[?#].*$/, "")
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/^\/+|\/+$/g, "");
        return this.toSafeId(cleaned);
    }
    // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
    toSafeId(slug) {
        return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
            const enc = encodeURIComponent(c);
            if (enc !== c)
                return enc;
            return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
        });
    }
    cleanField(value) {
        const v = value.trim();
        if (!v || v === "-" || v.toLowerCase() === "n/a")
            return "";
        return v;
    }
    titleCase(value) {
        if (!value)
            return value;
        return value.charAt(0).toUpperCase() + value.slice(1);
    }
    /**
     * Keyoapp thumbnails are CSS background-images, e.g.
     * style="background-image: url('https://.../img.jpg')". This extracts the
     * URL and (mirroring the Kotlin source) sets a width query param.
     */
    imageFromStyle(scope, selector) {
        const el = scope.find(selector).first();
        if (!el || el.length === 0)
            return "";
        const style = el.attr("style") || "";
        const match = style.match(/url\(['"]?([^('")]+)/);
        if (!match)
            return "";
        let src = match[1].trim();
        if (!src)
            return "";
        // Set a sane thumbnail width if the URL already has query params.
        if (src.includes("?")) {
            src = src.replace(/([?&])w=\d+/, "$1w=480");
            if (!/[?&]w=/.test(src))
                src += "&w=480";
        }
        else {
            src += "?w=480";
        }
        return src;
    }
    imageFromElement(img) {
        if (!img || img.length === 0)
            return "";
        let src = img.attr("data-lazy-src") ||
            img.attr("data-src") ||
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
        if (s.includes("ongoing") || s.includes("on going"))
            return "Ongoing";
        if (s.includes("hiatus") || s.includes("pause"))
            return "Hiatus";
        if (s.includes("cancel") || s.includes("drop"))
            return "Cancelled";
        return "Unknown";
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date();
        const direct = new Date(dateText);
        if (!isNaN(direct.getTime()))
            return direct;
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
        }
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
            if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
                continue;
            }
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
