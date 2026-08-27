import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { IkenSearchForm } from "./forms";
import { getBaseUrlOverride, getShowLockedChapters, getUseChaptersApi, IkenSettingsForm, setUseChaptersApi, } from "./settings";
class IkenInterceptor extends PaperbackInterceptor {
    getBaseUrl;
    constructor(id, getBaseUrl) {
        super(id);
        this.getBaseUrl = getBaseUrl;
    }
    async interceptRequest(request) {
        const baseUrl = this.getBaseUrl();
        // Image hosts (e.g. storage.<domain>) sit behind their own Cloudflare
        // challenge. Sending the JSON `accept` used for the API on an image
        // request is an anomalous, bot-like signal that can trigger a CF
        // challenge. Use a browser-like image accept for image requests.
        const accept = IkenInterceptor.isImageRequest(request.url)
            ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
            : "application/json, text/plain, */*";
        request.headers = {
            ...request.headers,
            referer: `${baseUrl}/`,
            origin: baseUrl,
            "user-agent": await Application.getDefaultUserAgent(),
            accept,
            "accept-language": "en-US,en;q=0.5",
        };
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
export class IkenExtension {
    sourceName;
    defaultBaseUrl;
    defaultApiUrl;
    perPage;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    /**
     * Iken sites serve their JSON API from an `api.` sub-domain. When the user
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
        this.perPage = config.perPage ?? 18;
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new IkenInterceptor("main", () => this.baseUrl);
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
        return new IkenSettingsForm(this.sourceName, this.defaultBaseUrl);
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
        let itemType;
        switch (section.id) {
            case "popular_section":
                orderBy = "totalViews";
                itemType = "featuredCarouselItem";
                break;
            case "latest_section":
                orderBy = "lastChapterAddedAt";
                itemType = "simpleCarouselItem";
                break;
            default:
                return { items: [] };
        }
        const url = new URLBuilder(this.apiUrl)
            .addPath("api")
            .addPath("query")
            .addQuery("page", "1")
            .addQuery("perPage", this.perPage.toString())
            .addQuery("searchTerm", "")
            .addQuery("orderBy", orderBy)
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const items = [];
        for (const post of data.posts ?? []) {
            if (this.isNovel(post))
                continue;
            items.push({
                type: itemType,
                mangaId: this.mangaIdFromPost(post),
                imageUrl: post.featuredImage ?? "",
                title: post.postTitle,
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
            { id: "lastChapterAddedAt", label: "Last Chapter" },
            { id: "totalViews", label: "Views" },
            { id: "createdAt", label: "Added Date" },
            { id: "chaptersCount", label: "Chapters Count" },
            { id: "postTitle", label: "Alphabetical" },
        ];
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata
            ?.searchMeta;
        return new IkenSearchForm(meta);
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
            .addPath("api")
            .addPath("query")
            .addQuery("page", page.toString())
            .addQuery("perPage", this.perPage.toString())
            .addQuery("searchTerm", titleQuery);
        if (effectiveOrderBy)
            builder.addQuery("orderBy", effectiveOrderBy);
        const status = searchMeta?.status?.[0];
        if (status)
            builder.addQuery("seriesStatus", status);
        const type = searchMeta?.type?.[0];
        if (type)
            builder.addQuery("seriesType", type);
        const direction = searchMeta?.orderDirection?.[0];
        if (direction)
            builder.addQuery("orderDirection", direction);
        const data = await this.fetchJson({
            url: builder.build(),
            method: "GET",
        });
        const results = [];
        for (const post of data.posts ?? []) {
            if (this.isNovel(post))
                continue;
            results.push({
                mangaId: this.mangaIdFromPost(post),
                imageUrl: post.featuredImage ?? "",
                title: post.postTitle,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const totalCount = data.totalCount ?? 0;
        const hasNextPage = totalCount > page * this.perPage;
        const reachedPageLimit = page >= IkenExtension.MAX_SEARCH_PAGES;
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
            .addPath("api")
            .addPath("post")
            .addQuery("postSlug", slug)
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const post = data.post;
        const secondaryTitles = [];
        if (post.alternativeTitles && post.alternativeTitles.trim()) {
            secondaryTitles.push(post.alternativeTitles.trim());
        }
        const genres = [];
        switch ((post.seriesType ?? "").toUpperCase()) {
            case "MANGA":
                genres.push("Manga");
                break;
            case "MANHUA":
                genres.push("Manhua");
                break;
            case "MANHWA":
                genres.push("Manhwa");
                break;
        }
        for (const g of post.genres ?? []) {
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
                primaryTitle: post.postTitle,
                secondaryTitles,
                thumbnailUrl: post.featuredImage ?? "",
                author: this.cleanField(post.author),
                artist: this.cleanField(post.artist),
                synopsis: this.stripHtml(post.postContent ?? ""),
                contentRating: this.contentRating,
                status: this.parseStatus(post.seriesStatus ?? ""),
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
        if (getUseChaptersApi(this.sourceName)) {
            // Upstream #18314: the `/api/chapters` endpoint is not always better than
            // the list embedded in `/api/post` — on some series it returns fewer
            // chapters. Fetch both, keep whichever is longer, and un-latch the
            // endpoint when it turns out not to help so the source self-heals.
            const chaptersUrl = new URLBuilder(this.apiUrl)
                .addPath("api")
                .addPath("chapters")
                .addQuery("postId", this.postIdFromId(sourceManga.mangaId))
                .build();
            const postUrl = new URLBuilder(this.apiUrl)
                .addPath("api")
                .addPath("post")
                .addQuery("postSlug", slug)
                .build();
            const [apiChapters, embeddedChapters] = await Promise.all([
                this.fetchJson({ url: chaptersUrl, method: "GET" })
                    .then((data) => this.mapChapters(sourceManga, data.post, slug))
                    .catch(() => []),
                this.fetchJson({ url: postUrl, method: "GET" })
                    .then((data) => this.mapChapters(sourceManga, data.post, slug))
                    .catch(() => []),
            ]);
            if (apiChapters.length <= embeddedChapters.length) {
                setUseChaptersApi(this.sourceName, false);
                return embeddedChapters;
            }
            return apiChapters;
        }
        const url = new URLBuilder(this.apiUrl)
            .addPath("api")
            .addPath("post")
            .addQuery("postSlug", slug)
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        // The embedded chapter list is sometimes truncated. When the post reports a
        // HIGHER authoritative count, latch on the chapters endpoint and retry
        // through it. Upstream #18314 tightened this from `!==` to `>`: a lower
        // reported total is not a truncation and previously caused a pointless
        // (and sometimes lossy) switch.
        const embedded = data.post.chapters ?? [];
        const total = data.totalChapterCount;
        if (typeof total === "number" && total > embedded.length) {
            setUseChaptersApi(this.sourceName, true);
            return this.getChapters(sourceManga);
        }
        return this.mapChapters(sourceManga, data.post, slug);
    }
    mapChapters(sourceManga, post, fallbackSlug) {
        const showLocked = getShowLockedChapters(this.sourceName);
        const chapters = [];
        const seriesSlug = post.slug ?? fallbackSlug;
        for (const ch of post.chapters ?? []) {
            // Only PUBLIC chapters. `isAccessible` was dropped upstream as
            // unreliable (keiyoushi PR #18064); locked-ness alone now decides
            // visibility and the lock marker.
            const isPublic = ch.chapterStatus === "PUBLIC";
            const isLocked = this.isChapterLocked(ch);
            if (!isPublic || (isLocked && !showLocked))
                continue;
            const chSeriesSlug = ch.mangaPost?.slug ?? seriesSlug;
            const chapterId = this.toSafeId(`/series/${chSeriesSlug}/${ch.slug}#${ch.id}`);
            const prefix = isLocked ? "🔒 " : "";
            const suffix = ch.title && ch.title.trim() ? ` - ${ch.title.trim()}` : "";
            const chNum = typeof ch.number === "number"
                ? ch.number
                : parseFloat(String(ch.number)) || 0;
            const title = `${prefix}Chapter ${ch.number}${suffix}`;
            chapters.push({
                chapterId,
                sourceManga,
                title,
                volume: 0,
                chapNum: chNum,
                publishDate: this.parseDate(ch.createdAt),
                langCode: this.langCode,
            });
        }
        return chapters;
    }
    /**
     * Mirrors upstream `Chapter.isLocked()`: an explicit lock, a timed lock, or a
     * priced chapter the user has not purchased.
     */
    isChapterLocked(ch) {
        if (ch.isLocked === true || ch.isTimeLocked === true)
            return true;
        const price = ch.price ?? 0;
        return ch.chapterPurchased !== true && price !== 0;
    }
    async getChapterDetails(chapter) {
        const id = this.chapterApiId(chapter.chapterId);
        const url = new URLBuilder(this.apiUrl)
            .addPath("api")
            .addPath("chapter")
            .addQuery("chapterId", id)
            .build();
        const response = await this.fetchJson({
            url,
            method: "GET",
        });
        // The API wraps the chapter data in a `chapter` envelope.
        const data = response.chapter ?? response;
        if (data.isShortLinkLocked)
            throw new Error("Chapter locked (short link)");
        if (data.isLockedByCoins)
            throw new Error("Chapter locked (coins required)");
        if (data.isPermanentlyLocked)
            throw new Error("Chapter permanently locked");
        const sorted = [...(data.images ?? [])].sort((a, b) => {
            const ao = a.order ?? Number.MAX_SAFE_INTEGER;
            const bo = b.order ?? Number.MAX_SAFE_INTEGER;
            return ao - bo;
        });
        const pages = sorted
            .map((p) => p.url)
            .filter((u) => typeof u === "string" && u.length > 0)
            .map((u) => u.replace(/ /g, "%20"));
        if (pages.length === 0)
            throw new Error("No pages found for this chapter");
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
    isNovel(post) {
        return (post.isNovel === true ||
            (post.seriesType ?? "").toLowerCase() === "novel");
    }
    /**
     * Iken manga IDs encode the slug and numeric post id as `slug#id`. The slug
     * is what the `/api/post` endpoint expects.
     */
    mangaIdFromPost(post) {
        return this.toSafeId(`${post.slug}#${post.id}`);
    }
    slugFromId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        return decoded.split("#")[0];
    }
    /**
     * Manga IDs are stored as `{slug}#{postId}`. The `/api/chapters` endpoint
     * needs the numeric post id after `#`.
     */
    postIdFromId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        return decoded.substring(decoded.lastIndexOf("#") + 1);
    }
    /**
     * Chapter IDs are stored as `/series/{seriesSlug}/{chapterSlug}#{chapterId}`.
     * The `/api/chapter` endpoint needs the numeric id after `#`.
     */
    chapterApiId(chapterId) {
        const decoded = this.safeDecode(chapterId);
        return decoded.substring(decoded.lastIndexOf("#") + 1);
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
            case "COMING_SOON":
                return "Ongoing";
            case "COMPLETED":
                return "Completed";
            case "CANCELLED":
            case "DROPPED":
                return "Cancelled";
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
