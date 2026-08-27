import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { EZManhwaSearchForm } from "./forms";
import { getBaseUrlOverride, getShowLockedChapters, EZManhwaSettingsForm, } from "./settings";
class EZManhwaInterceptor extends PaperbackInterceptor {
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
            accept: "application/json, text/plain, */*",
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
export class EZManhwaExtension {
    sourceName;
    defaultBaseUrl;
    defaultApiUrl;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
    static PER_PAGE = 20;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    /**
     * The API host lives on a separate domain from the site, so the base-URL
     * override (which only changes the reader site) does not affect it.
     */
    get apiUrl() {
        return this.defaultApiUrl;
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
        this.defaultApiUrl = config.apiUrl.replace(/\/+$/, "");
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new EZManhwaInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new EZManhwaSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        let sort;
        let itemType;
        switch (section.id) {
            case "popular_section":
                sort = "popular";
                itemType = "featuredCarouselItem";
                break;
            case "latest_section":
                sort = "latest";
                itemType = "simpleCarouselItem";
                break;
            default:
                return { items: [] };
        }
        const url = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addQuery("page", "1")
            .addQuery("perPage", EZManhwaExtension.PER_PAGE.toString())
            .addQuery("sort", sort)
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const items = [];
        for (const series of data.data ?? []) {
            if (this.isNovel(series))
                continue;
            items.push({
                type: itemType,
                mangaId: this.toSafeId(series.slug),
                imageUrl: series.cover ?? "",
                title: series.title,
                metadata: undefined,
            });
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSortingOptions() {
        return [
            { id: "latest", label: "Latest" },
            { id: "popular", label: "Popular" },
            { id: "newest", label: "Newest" },
            { id: "alphabetical", label: "Alphabetical" },
        ];
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new EZManhwaSearchForm(meta);
    }
    async getSearchResults(query, metadata, sortingOption) {
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        let builder;
        if (titleQuery) {
            // Search endpoint: only a query term, no filters.
            builder = new URLBuilder(this.apiUrl)
                .addPath("series")
                .addPath("search")
                .addQuery("page", page.toString())
                .addQuery("perPage", EZManhwaExtension.PER_PAGE.toString())
                .addQuery("q", titleQuery);
        }
        else {
            // Browse endpoint: sort + status + type filters apply here.
            const sortId = sortingOption?.id ?? "";
            const filterSort = searchMeta?.sort?.[0] ?? "";
            const effectiveSort = sortId || filterSort || "latest";
            builder = new URLBuilder(this.apiUrl)
                .addPath("series")
                .addQuery("page", page.toString())
                .addQuery("perPage", EZManhwaExtension.PER_PAGE.toString())
                .addQuery("sort", effectiveSort);
            const status = searchMeta?.status?.[0];
            if (status)
                builder.addQuery("status", status);
            const type = searchMeta?.type?.[0];
            if (type)
                builder.addQuery("type", type);
        }
        const data = await this.fetchJson({
            url: builder.build(),
            method: "GET",
        });
        const results = [];
        for (const series of data.data ?? []) {
            if (this.isNovel(series))
                continue;
            results.push({
                mangaId: this.toSafeId(series.slug),
                imageUrl: series.cover ?? "",
                title: series.title,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const totalPages = data.totalPages ?? 0;
        const currentPage = data.current ?? page;
        const hasNextPage = currentPage < totalPages;
        const reachedPageLimit = page >= EZManhwaExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.slugFromId(mangaId);
        const url = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addPath(slug)
            .build();
        const series = await this.fetchJson({
            url,
            method: "GET",
        });
        const secondaryTitles = [];
        if (series.alternativeTitles && series.alternativeTitles.trim()) {
            secondaryTitles.push(series.alternativeTitles.trim());
        }
        const genres = [];
        for (const g of series.genres ?? []) {
            if (g.name)
                genres.push(g.name);
        }
        const uniqueGenres = [...new Set(genres)];
        const tagGroups = [];
        if (uniqueGenres.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: uniqueGenres.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title,
                secondaryTitles,
                thumbnailUrl: series.cover ?? "",
                author: this.cleanField(series.author),
                artist: this.cleanField(series.artist),
                synopsis: this.stripHtml(series.description ?? ""),
                contentRating: this.contentRating,
                status: this.parseStatus(series.status ?? ""),
                tagGroups,
                shareUrl: this.getMangaShareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.slugFromId(sourceManga.mangaId);
        const showLocked = getShowLockedChapters(this.sourceName);
        const chapters = [];
        let page = 1;
        // Bound the loop to avoid runaway pagination.
        for (let i = 0; i < 50; i++) {
            const url = new URLBuilder(this.apiUrl)
                .addPath("series")
                .addPath(slug)
                .addPath("chapters")
                .addQuery("page", page.toString())
                .addQuery("perPage", "100")
                .addQuery("sort", "desc")
                .build();
            const data = await this.fetchJson({
                url,
                method: "GET",
            });
            for (const ch of data.data ?? []) {
                const locked = ch.requiresPurchase === true;
                if (locked && !showLocked)
                    continue;
                const chapterId = this.toSafeId(`series/${slug}/chapters/${ch.slug}`);
                const prefix = locked ? "🔒 " : "";
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: prefix + this.buildChapterName(ch),
                    volume: 0,
                    chapNum: typeof ch.number === "number" && !isNaN(ch.number)
                        ? ch.number
                        : -1,
                    publishDate: this.parseDate(ch.createdAt ?? ""),
                    langCode: this.langCode,
                });
            }
            const totalPages = data.totalPages ?? 0;
            const currentPage = data.current ?? page;
            if (currentPage >= totalPages)
                break;
            page++;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        // chapterId encodes the full path `series/{slug}/chapters/{chapterSlug}`.
        const path = this.safeDecode(chapter.chapterId);
        const url = `${this.apiUrl}/${path}`;
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        if (data.requiresPurchase === true) {
            throw new Error("Chapter requires purchase");
        }
        const pages = (data.images ?? []).map((i) => i.url.replace(/ /g, "%20"));
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const slug = this.slugFromId(mangaId);
        return new URLBuilder(this.baseUrl)
            .addPath("series")
            .addPath(slug)
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    isNovel(series) {
        return (series.type ?? "").toUpperCase() === "NOVEL";
    }
    buildChapterName(ch) {
        const num = ch.number;
        const numStr = typeof num === "number" && !isNaN(num)
            ? Number.isInteger(num)
                ? String(num)
                : String(num)
            : "";
        const title = (ch.title ?? "").trim();
        if (!numStr) {
            return title || "Chapter";
        }
        if (!title || title === numStr) {
            return `Chapter ${numStr}`;
        }
        if (/^(chapter|ch\.?|episode|ep\.?)\s*/i.test(title) && title.includes(numStr)) {
            return title;
        }
        if (title.startsWith("-") || title.startsWith(":")) {
            return `Chapter ${numStr} ${title}`;
        }
        return `Chapter ${numStr} - ${title}`;
    }
    slugFromId(mangaId) {
        return this.safeDecode(mangaId);
    }
    safeDecode(value) {
        try {
            return decodeURIComponent(value);
        }
        catch {
            return value;
        }
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
        if (!value)
            return undefined;
        const v = value.trim();
        if (!v || v === "-" || v.toLowerCase() === "n/a")
            return undefined;
        return v;
    }
    stripHtml(html) {
        if (!html)
            return "";
        return html
            .replace(/<br\s*\/?>(?=)/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .trim();
    }
    parseStatus(status) {
        switch (status.toUpperCase()) {
            case "ONGOING":
            case "MASS_RELEASED":
                return "Ongoing";
            case "COMPLETED":
                return "Completed";
            case "DROPPED":
                return "Cancelled";
            case "HIATUS":
                return "Hiatus";
            default:
                return "Unknown";
        }
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date();
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
            if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
                continue;
            }
            this.cookieStorageInterceptor.setCookie(cookie);
        }
    }
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const jsonStr = Application.arrayBufferToUTF8String(data);
        return JSON.parse(jsonStr);
    }
}
