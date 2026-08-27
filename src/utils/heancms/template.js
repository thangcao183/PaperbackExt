import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { HeanCmsSearchForm } from "./forms";
import { getBaseUrlOverride, getShowPaidChapters, HeanCmsSettingsForm, } from "./settings";
class HeanCmsInterceptor extends PaperbackInterceptor {
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
export class HeanCmsExtension {
    sourceName;
    defaultBaseUrl;
    defaultApiUrl;
    defaultCdnUrl;
    coverPath;
    mangaSubDirectory;
    useNewQueryEndpoint;
    useNewChapterEndpoint;
    latestSortBy;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
    static PER_PAGE = 12;
    static PER_PAGE_CHAPTERS = 1000;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    /**
     * HeanCms sites serve their JSON API from an `api.` sub-domain. When the user
     * overrides the base URL we derive the API URL from it, otherwise we use the
     * configured default.
     */
    get apiUrl() {
        const override = getBaseUrlOverride(this.sourceName);
        if (override) {
            return this.deriveApiUrl(override);
        }
        return this.defaultApiUrl;
    }
    get cdnUrl() {
        // When a custom cdnUrl was configured we keep it; otherwise it tracks the
        // (possibly overridden) API URL.
        if (this.defaultCdnUrl !== this.defaultApiUrl) {
            return this.defaultCdnUrl;
        }
        return this.apiUrl;
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
        this.defaultApiUrl = (config.apiUrl ?? this.deriveApiUrl(config.baseUrl))
            .replace(/\/+$/, "");
        this.defaultCdnUrl = (config.cdnUrl ?? this.defaultApiUrl).replace(/\/+$/, "");
        this.coverPath = config.coverPath ?? "";
        this.mangaSubDirectory = config.mangaSubDirectory ?? "series";
        this.useNewQueryEndpoint = config.useNewQueryEndpoint ?? false;
        this.useNewChapterEndpoint = config.useNewChapterEndpoint ?? false;
        this.latestSortBy = config.latestSortBy ?? "desc";
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new HeanCmsInterceptor("main", () => this.baseUrl);
    }
    deriveApiUrl(baseUrl) {
        const cleaned = baseUrl.replace(/\/+$/, "");
        const match = cleaned.match(/^(https?:\/\/)(.+)$/);
        if (match) {
            return `${match[1]}api.${match[2]}`;
        }
        return cleaned;
    }
    async getSettingsForm() {
        return new HeanCmsSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        let orderBy;
        let order;
        let itemType;
        switch (section.id) {
            case "popular_section":
                orderBy = "total_views";
                order = "desc";
                itemType = "featuredCarouselItem";
                break;
            case "latest_section":
                orderBy = "latest";
                order = this.latestSortBy;
                itemType = "simpleCarouselItem";
                break;
            default:
                return { items: [] };
        }
        const url = this.buildQueryUrl({
            page: 1,
            orderBy,
            order,
        });
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const items = [];
        for (const series of data.data ?? []) {
            items.push({
                type: itemType,
                mangaId: this.mangaIdFromSeries(series),
                imageUrl: this.toAbsoluteThumbnailUrl(series.thumbnail),
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
            { id: "total_views", label: "Views" },
            { id: "title", label: "A-Z" },
            { id: "latest", label: "Latest" },
            { id: "created_at", label: "Created" },
        ];
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new HeanCmsSearchForm(meta);
    }
    async getSearchResults(query, metadata, sortingOption) {
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const sortId = sortingOption?.id ?? "";
        const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
        const effectiveOrderBy = sortId || filterOrderBy || "total_views";
        const status = searchMeta?.status?.[0] ?? "All";
        const direction = searchMeta?.orderDirection?.[0] ?? "desc";
        const url = this.buildQueryUrl({
            page,
            queryString: titleQuery,
            orderBy: effectiveOrderBy,
            order: direction,
            status,
        });
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const results = [];
        for (const series of data.data ?? []) {
            results.push({
                mangaId: this.mangaIdFromSeries(series),
                imageUrl: this.toAbsoluteThumbnailUrl(series.thumbnail),
                title: series.title,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const currentPage = data.meta?.current_page ?? page;
        const lastPage = data.meta?.last_page ?? page;
        const hasNextPage = currentPage < lastPage;
        const reachedPageLimit = page >= HeanCmsExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
        };
    }
    buildQueryUrl(opts) {
        const statusKey = this.useNewQueryEndpoint ? "status" : "series_status";
        return new URLBuilder(this.apiUrl)
            .addPath("query")
            .addQuery("query_string", opts.queryString ?? "")
            .addQuery(statusKey, opts.status ?? "All")
            .addQuery("order", opts.order)
            .addQuery("orderBy", opts.orderBy)
            .addQuery("series_type", "Comic")
            .addQuery("page", opts.page.toString())
            .addQuery("perPage", HeanCmsExtension.PER_PAGE.toString())
            .addQuery("tags_ids", "[]")
            .addQuery("adult", "true")
            .build();
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async fetchSeries(slug) {
        const url = new URLBuilder(this.apiUrl)
            .addPath("series")
            .addPath(slug)
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        return data;
    }
    async getMangaDetails(mangaId) {
        const slug = this.slugFromId(mangaId);
        const series = await this.fetchSeries(slug);
        const tagNames = (series.tags ?? [])
            .map((t) => t.name)
            .filter((n) => !!n)
            .sort((a, b) => a.localeCompare(b));
        const tagGroups = [];
        if (tagNames.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: tagNames.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title,
                secondaryTitles: [],
                thumbnailUrl: this.toAbsoluteThumbnailUrl(series.thumbnail),
                author: this.cleanField(series.author),
                artist: this.cleanField(series.studio),
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
        const decoded = this.safeDecode(sourceManga.mangaId);
        const slug = decoded.split("#")[0];
        const seriesId = decoded.includes("#")
            ? decoded.substring(decoded.lastIndexOf("#") + 1)
            : "";
        const showPaid = getShowPaidChapters(this.sourceName);
        const now = Date.now();
        let rawChapters;
        if (this.useNewChapterEndpoint && seriesId) {
            rawChapters = await this.fetchChaptersViaApi(seriesId);
        }
        else {
            const series = await this.fetchSeries(slug);
            rawChapters = [];
            for (const season of series.seasons ?? []) {
                for (const ch of season.chapters ?? []) {
                    rawChapters.push(ch);
                }
            }
        }
        const chapters = [];
        for (const ch of rawChapters) {
            const price = ch.price ?? 0;
            if (price !== 0 && !showPaid)
                continue;
            const publishDate = this.parseDate(ch.created_at ?? "");
            if (publishDate.getTime() > now)
                continue;
            const name = (ch.chapter_name ?? "").trim();
            const title = (ch.chapter_title ?? "").trim();
            const lock = price !== 0 ? " 🔒" : "";
            const display = `${name}${title ? ` - ${title}` : ""}${lock}`;
            const chapterId = this.toSafeId(`/${this.mangaSubDirectory}/${slug}/${ch.chapter_slug}#${ch.id}`);
            chapters.push({
                chapterId,
                sourceManga,
                title: display || `Chapter`,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
                publishDate,
                langCode: this.langCode,
            });
        }
        return chapters;
    }
    async fetchChaptersViaApi(seriesId) {
        const all = [];
        let page = 1;
        // Cap pages defensively; PER_PAGE_CHAPTERS is large so this rarely loops.
        for (let i = 0; i < 50; i++) {
            const url = new URLBuilder(this.apiUrl)
                .addPath("chapter")
                .addPath("query")
                .addQuery("page", page.toString())
                .addQuery("perPage", HeanCmsExtension.PER_PAGE_CHAPTERS.toString())
                .addQuery("series_id", seriesId)
                .build();
            const data = await this.fetchJson({
                url,
                method: "GET",
            });
            for (const ch of data.data ?? [])
                all.push(ch);
            const current = data.meta?.current_page ?? page;
            const last = data.meta?.last_page ?? page;
            if (current >= last)
                break;
            page = current + 1;
        }
        return all;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const pathBeforeHash = decoded.substring(0, decoded.lastIndexOf("#"));
        const apiPath = pathBeforeHash.replace(`/${this.mangaSubDirectory}/`, "/chapter/");
        const url = `${this.apiUrl}${apiPath}`;
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const chapterData = data.chapter?.chapter_data;
        if (data.paywall && (chapterData === null || chapterData === undefined)) {
            throw new Error("This chapter is behind a paywall");
        }
        let images;
        if (this.useNewChapterEndpoint) {
            images = chapterData?.images ?? [];
        }
        else {
            images = data.data ?? [];
        }
        const pages = images.map((img) => this.toAbsoluteImageUrl(img));
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const slug = this.slugFromId(mangaId);
        return new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubDirectory)
            .addPath(slug)
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    /**
     * HeanCms manga IDs encode the slug and numeric id as `slug#id`. The slug is
     * what the `/series/{slug}` endpoint expects; the id is used by the new
     * chapter-query endpoint.
     */
    mangaIdFromSeries(series) {
        return this.toSafeId(`${series.series_slug}#${series.id}`);
    }
    slugFromId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        return decoded.split("#")[0];
    }
    toAbsoluteThumbnailUrl(thumb) {
        if (!thumb)
            return "";
        if (/^https?:\/\//.test(thumb))
            return thumb;
        return this.joinCdn(thumb);
    }
    toAbsoluteImageUrl(img) {
        if (/^https?:\/\//.test(img))
            return img;
        return this.joinCdn(img);
    }
    joinCdn(path) {
        const builder = new URLBuilder(this.cdnUrl);
        if (this.coverPath)
            builder.addPath(this.coverPath);
        builder.addPath(path);
        return builder.build();
    }
    parseChapterNumber(name) {
        const match = name.match(/(\d+(\.\d+)?)/);
        if (match)
            return parseFloat(match[1]);
        return 0;
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
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
    parseStatus(status) {
        switch (status.toLowerCase()) {
            case "ongoing":
                return "Ongoing";
            case "hiatus":
                return "Hiatus";
            case "dropped":
            case "cancelled":
            case "canceled":
                return "Cancelled";
            case "completed":
            case "finished":
                return "Completed";
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
