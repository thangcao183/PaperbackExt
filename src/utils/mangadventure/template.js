import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { MangAdventureSearchForm } from "./forms";
import { getBaseUrlOverride, MangAdventureSettingsForm } from "./settings";
class MangAdventureInterceptor extends PaperbackInterceptor {
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
export class MangAdventureExtension {
    sourceName;
    defaultBaseUrl;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    get apiUrl() {
        return `${this.baseUrl}/api/v2`;
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
        this.requestManager = new MangAdventureInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new MangAdventureSettingsForm(this.sourceName, this.defaultBaseUrl);
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
    async getDiscoverSectionItems(section, metadata) {
        let sort;
        let itemType;
        switch (section.id) {
            case "popular_section":
                sort = "-views";
                itemType = "featuredCarouselItem";
                break;
            case "latest_section":
                sort = "-latest_upload";
                itemType = "simpleCarouselItem";
                break;
            default:
                return { items: [] };
        }
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const url = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addQuery("page", page.toString())
            .addQuery("sort", sort)
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const items = (data.results ?? []).map((s) => ({
            type: itemType,
            mangaId: this.toSafeId(s.slug),
            imageUrl: s.cover ?? "",
            title: s.title,
            metadata: undefined,
        }));
        const hasNextPage = data.last === false;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSortingOptions() {
        return [
            { id: "-views", label: "Most Views" },
            { id: "-latest_upload", label: "Latest Upload" },
            { id: "title", label: "Title (A-Z)" },
            { id: "-title", label: "Title (Z-A)" },
            { id: "-chapter_count", label: "Chapter Count" },
        ];
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new MangAdventureSearchForm(meta);
    }
    async getSearchResults(query, metadata, sortingOption) {
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const sortId = sortingOption?.id ?? "";
        const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
        const effectiveOrderBy = sortId || filterOrderBy;
        const builder = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addQuery("page", page.toString())
            .addQuery("title", titleQuery);
        if (effectiveOrderBy)
            builder.addQuery("sort", effectiveOrderBy);
        const author = searchMeta?.author?.trim();
        if (author)
            builder.addQuery("author", author);
        const artist = searchMeta?.artist?.trim();
        if (artist)
            builder.addQuery("artist", artist);
        const status = searchMeta?.status?.[0];
        if (status && status !== "any")
            builder.addQuery("status", status);
        const data = await this.fetchJson({
            url: builder.build(),
            method: "GET",
        });
        const results = (data.results ?? []).map((s) => ({
            mangaId: this.toSafeId(s.slug),
            imageUrl: s.cover ?? "",
            title: s.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = data.last === false;
        const reachedPageLimit = page >= MangAdventureExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const url = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addPath(slug)
            .build();
        const series = await this.fetchJson({ url, method: "GET" });
        const secondaryTitles = [];
        for (const alias of series.aliases ?? []) {
            if (alias && alias.trim())
                secondaryTitles.push(alias.trim());
        }
        const tagGroups = [];
        const categories = (series.categories ?? []).filter((c) => c && c.trim());
        if (categories.length > 0) {
            tagGroups.push({
                id: "categories",
                title: "Categories",
                tags: categories.map((c) => ({
                    id: c.toLowerCase().replace(/\s+/g, "-"),
                    title: c,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title,
                secondaryTitles,
                thumbnailUrl: series.cover ?? "",
                author: this.joinField(series.authors),
                artist: this.joinField(series.artists),
                synopsis: (series.description ?? "").trim(),
                contentRating: this.contentRating,
                status: this.parseStatus(series),
                tagGroups,
                shareUrl: this.getMangaShareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const url = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addPath(slug)
            .addPath("chapters")
            .addQuery("date_format", "timestamp")
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const chapters = [];
        for (const ch of data.results ?? []) {
            const title = `${ch.full_title}${ch.final ? " [END]" : ""}`;
            chapters.push({
                chapterId: String(ch.id),
                sourceManga,
                title,
                volume: ch.volume ?? 0,
                chapNum: ch.number,
                publishDate: this.parseTimestamp(ch.published),
                langCode: this.langCode,
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = new URLBuilder(this.apiUrl)
            .addPath("chapters")
            .addPath(chapter.chapterId)
            .addPath("pages")
            .addQuery("track", "true")
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const sorted = [...(data.results ?? [])].sort((a, b) => a.number - b.number);
        const pages = sorted.map((p) => p.image);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        return new URLBuilder(this.baseUrl)
            .addPath("reader")
            .addPath(slug)
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
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
    joinField(values) {
        if (!values || values.length === 0)
            return undefined;
        const joined = values
            .filter((v) => v && v.trim())
            .join(", ")
            .trim();
        return joined.length > 0 ? joined : undefined;
    }
    parseStatus(series) {
        if (series.licensed === true)
            return "Completed";
        switch ((series.status ?? "").toLowerCase()) {
            case "completed":
                return "Completed";
            case "ongoing":
                return "Ongoing";
            case "hiatus":
                return "Hiatus";
            case "canceled":
            case "cancelled":
                return "Cancelled";
            default:
                return "Unknown";
        }
    }
    parseTimestamp(value) {
        const num = typeof value === "number" ? value : parseInt(value, 10);
        if (!isNaN(num)) {
            // API returns Unix seconds when date_format=timestamp.
            return new Date(num * 1000);
        }
        const direct = new Date(String(value));
        return isNaN(direct.getTime()) ? new Date() : direct;
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
