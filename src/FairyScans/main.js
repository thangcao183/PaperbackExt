import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://fairyscans.org";
const NONCE_REGEX = /"nonce"\s*:\s*"([^"]+)"/;
const AUTHOR_REGEX = /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/;
const CHAPTER_NUM_REGEX = /(?:chapter|ch)\s*(\d+(?:\.\d+)?)/i;
const SORT_VALUES = ["latest", "popular", "rating", "az", "newest"];
const GENRE_VALUES = [
    { id: "action", title: "Action" },
    { id: "adaptation", title: "Adaptation" },
    { id: "adventure", title: "Adventure" },
    { id: "bloody", title: "Bloody" },
    { id: "comedy", title: "Comedy" },
    { id: "comic", title: "Comic" },
    { id: "demons", title: "Demons" },
    { id: "drama", title: "Drama" },
    { id: "fantasy", title: "Fantasy" },
    { id: "historical", title: "Historical" },
    { id: "horror", title: "Horror" },
    { id: "isekai", title: "Isekai" },
    { id: "josei", title: "Josei" },
    { id: "kids", title: "Kids" },
    { id: "magic", title: "Magic" },
    { id: "manga", title: "Manga" },
    { id: "manhua", title: "Manhua" },
    { id: "manhwa", title: "Manhwa" },
    { id: "mystery", title: "Mystery" },
    { id: "office-workers", title: "Office workers" },
    { id: "one-shot", title: "One shot" },
    { id: "psychological", title: "Psychological" },
    { id: "reincarnation", title: "Reincarnation" },
    { id: "revenge", title: "Revenge" },
    { id: "romance", title: "Romance" },
    { id: "royal-family", title: "Royal family" },
    { id: "school-life", title: "School Life" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shounen", title: "Shounen" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "superhero", title: "Superhero" },
    { id: "supernatural", title: "Supernatural" },
    { id: "time-travel", title: "Time travel" },
    { id: "tragedy", title: "Tragedy" },
    { id: "transmigration", title: "Transmigration" },
    { id: "villainess", title: "Villainess" },
    { id: "webtoons", title: "Webtoons" },
];
class FairyScansInterceptor extends PaperbackInterceptor {
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
export class FairyScansExtension {
    requestManager = new FairyScansInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
        bufferInterval: 1,
        ignoreImages: true,
    });
    filterNonce = null;
    loadMoreNonce = null;
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
            {
                id: "genres",
                title: "Genres",
                type: DiscoverSectionType.genres,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id === "genres") {
            const items = GENRE_VALUES.map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre: g.id },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "popular" : "latest";
        const { items: mangas, hasMore } = await this.browse({
            page,
            sort,
            genre: "",
            query: "",
        });
        const items = mangas.map((m) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: hasMore ? { page: page + 1, sort } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const queryMeta = query.metadata;
        const genre = meta?.genre ?? queryMeta?.genre ?? "";
        const { items: mangas, hasMore } = await this.browse({
            page,
            sort: "latest",
            genre,
            query: titleQuery,
        });
        const results = mangas.map((m) => ({
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items: results,
            metadata: hasMore ? { page: page + 1, genre } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Browse (admin-ajax shared logic)
    // ----------------------------------------------------------------
    async getNonce(page) {
        if (this.filterNonce === null || this.loadMoreNonce === null) {
            const $ = await this.fetchCheerio({
                url: `${BASE_URL}/manga/`,
                method: "GET",
            });
            const html = $.html();
            const browseIdx = html.indexOf("greedArchiveBrowse");
            const moreIdx = html.indexOf("greedArchiveMore");
            const browseSlice = browseIdx >= 0 ? html.slice(browseIdx) : html;
            const moreSlice = moreIdx >= 0 ? html.slice(moreIdx) : html;
            this.filterNonce = NONCE_REGEX.exec(browseSlice)?.[1] ?? null;
            this.loadMoreNonce = NONCE_REGEX.exec(moreSlice)?.[1] ?? null;
        }
        const nonce = page === 1 ? this.filterNonce : this.loadMoreNonce;
        if (!nonce) {
            throw new Error("Could not find required nonces for filtering");
        }
        return nonce;
    }
    async browse(opts) {
        const nonce = await this.getNonce(opts.page);
        const action = opts.page === 1 ? "greed_filter_series" : "greed_archive_load_more";
        const sort = SORT_VALUES.includes(opts.sort) ? opts.sort : "latest";
        const params = [
            ["action", action],
            ["nonce", nonce],
            ["page", opts.page.toString()],
            ["per_initial", "20"],
            ["per_more", "10"],
            ["filters[sort]", sort],
            ["filters[order]", "desc"],
            ["filters[status]", "all"],
            ["filters[type]", "all"],
            ["filters[genre]", opts.genre],
            ["filters[creator]", ""],
            ["filters[s]", opts.query],
        ];
        const body = params
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
        let dto;
        try {
            dto = JSON.parse(Application.arrayBufferToUTF8String(data));
        }
        catch (e) {
            this.filterNonce = null;
            this.loadMoreNonce = null;
            throw e;
        }
        if (dto.success === false) {
            this.filterNonce = null;
            this.loadMoreNonce = null;
            throw new Error("Failed to fetch search results from the source");
        }
        const hasMore = dto.has_more ?? dto.data?.has_more ?? false;
        const gridHtml = dto.data?.grid_html ?? dto.html ?? "";
        const dom = htmlparser2.parseDocument(gridHtml);
        const $ = cheerio.load(dom);
        const items = [];
        const seen = new Set();
        $("article").each((_, element) => {
            const el = $(element);
            const formatBadge = el
                .find(".greed-browse-card-format-badge")
                .first()
                .text()
                .trim()
                .toLowerCase();
            const isNovel = el.find(".greed-browse-card-format-badge--novel").length > 0 ||
                formatBadge === "novel";
            if (isNovel)
                return;
            const link = el
                .find("h2 a, a.greed-browse-card-image, a.greed-archive-cover")
                .first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const mangaId = this.parsePath(href);
            if (!mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            const title = el.find("h2").first().text().trim();
            const imageUrl = this.imageFromElement(el.find("img").first());
            if (!title)
                return;
            items.push({ mangaId, imageUrl, title });
        });
        return { items, hasMore };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $(".greed-series-title, h1").first().text().trim() ||
            this.safeDecode(mangaId);
        let author;
        const jsonLd = $("script[type='application/ld+json']").first().html() || "";
        if (jsonLd) {
            author = AUTHOR_REGEX.exec(jsonLd)?.[1];
        }
        const synopsis = $(".greed-series-description").first().text().trim();
        const thumbnailUrl = this.imageFromElement($(".greed-series-cover-img").first());
        const genres = $(".greed-series-genre")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const statusText = $(".fairy-series-clean__meta-item--status .fairy-series-clean__meta-v")
            .first()
            .text()
            .toLowerCase();
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
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        const seen = new Set();
        $(".greed-series-chapter").each((_, element) => {
            const el = $(element);
            const isLocked = el.hasClass("is-locked");
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const rawName = el
                .find(".greed-series-chapter-title")
                .first()
                .text()
                .trim();
            const orderAttr = parseFloat(el.attr("data-chapter-order") || "");
            const orderFallback = parseFloat(CHAPTER_NUM_REGEX.exec(rawName)?.[1] ?? "");
            const finalOrder = !isNaN(orderAttr)
                ? orderAttr
                : !isNaN(orderFallback)
                    ? orderFallback
                    : -1;
            const dateText = el
                .find(".greed-series-chapter-date")
                .first()
                .text()
                .trim();
            entries.push({
                order: finalOrder,
                chapter: {
                    chapterId,
                    sourceManga,
                    title: isLocked ? `🔒 ${rawName}` : rawName,
                    volume: 0,
                    chapNum: finalOrder >= 0 ? finalOrder : 0,
                    publishDate: this.parseRelativeDate(dateText),
                    langCode: "🇬🇧",
                },
            });
        });
        return entries
            .sort((a, b) => b.order - a.order)
            .map((e) => e.chapter);
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        let scriptData = "";
        $("script").each((_, element) => {
            const content = $(element).html() || "";
            if (content.includes("ts_reader.run")) {
                scriptData = content;
                return false;
            }
            return undefined;
        });
        if (!scriptData) {
            throw new Error("Reader script not found");
        }
        const jsonStr = scriptData
            .substring(scriptData.indexOf("ts_reader.run(") + "ts_reader.run(".length)
            .replace(/\);?\s*$/, "")
            .trim();
        let dto;
        try {
            dto = JSON.parse(jsonStr);
        }
        catch {
            throw new Error("Failed to parse reader data");
        }
        const images = dto.sources?.[0]?.images ?? [];
        const pages = images.map((img) => this.absoluteUrl(img));
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
        if (s.includes("dropped"))
            return "Cancelled";
        return "Unknown";
    }
    parseRelativeDate(dateStr) {
        if (!dateStr)
            return new Date(0);
        const split = dateStr.split(" ");
        if (split.length < 2)
            return new Date(0);
        const count = parseInt(split[0], 10);
        if (isNaN(count))
            return new Date(0);
        const unit = split[1].toLowerCase();
        const now = Date.now();
        let ms;
        if (unit.includes("year"))
            ms = count * 365 * 24 * 60 * 60 * 1000;
        else if (unit.includes("month"))
            ms = count * 30 * 24 * 60 * 60 * 1000;
        else if (unit.includes("week"))
            ms = count * 7 * 24 * 60 * 60 * 1000;
        else if (unit.includes("day"))
            ms = count * 24 * 60 * 60 * 1000;
        else if (unit.includes("hour"))
            ms = count * 60 * 60 * 1000;
        else if (unit.includes("min"))
            ms = count * 60 * 1000;
        else if (unit.includes("sec"))
            ms = count * 1000;
        else
            return new Date(0);
        return new Date(now - ms);
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
export const FairyScans = new FairyScansExtension();
