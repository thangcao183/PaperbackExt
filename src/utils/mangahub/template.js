import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { MangaHubSearchForm } from "./forms";
import { getBaseUrlOverride, getUseGenericTitle, MangaHubSettingsForm, } from "./settings";
// Shared backend constants (identical across every MangaHub mirror).
// api.mghcdn.com is the original/working GraphQL endpoint. (api2.mangahub.io
// is currently unreachable, so it is no longer used.) The interceptor attaches
// the x-mhub-access header to any of these URLs.
const GRAPHQL_URLS = ["https://api.mghcdn.com/graphql"];
const IMAGE_CDN = "https://imgx.mghcdn.com";
const THUMB_CDN = "https://thumb.mghcdn.com";
const PER_PAGE = 30;
const ACCESS_KEY_STATE = "mangahub.accessKey";
const RELOAD_KEY_STATE = "mangahub.reloadKey";
// A small pool of desktop User-Agents rotated when (re)fetching the API key,
// mirroring HakuNeko's randomised-UA behaviour to reduce rate-limit hits.
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
];
class MangaHubInterceptor extends PaperbackInterceptor {
    getBaseUrl;
    getAccessKey;
    getUserAgent;
    constructor(id, getBaseUrl, getAccessKey, getUserAgent) {
        super(id);
        this.getBaseUrl = getBaseUrl;
        this.getAccessKey = getAccessKey;
        this.getUserAgent = getUserAgent;
    }
    async interceptRequest(request) {
        const baseUrl = this.getBaseUrl();
        const overrideUA = this.getUserAgent();
        const headers = {
            ...request.headers,
            referer: `${baseUrl}/`,
            origin: baseUrl,
            "user-agent": overrideUA || (await Application.getDefaultUserAgent()),
            "accept-language": "en-US,en;q=0.5",
        };
        // GraphQL calls require the API key obtained from the mirror site.
        if (GRAPHQL_URLS.some((u) => request.url.startsWith(u))) {
            headers["content-type"] = "application/json";
            headers["accept"] = "application/json";
            const key = this.getAccessKey();
            if (key) {
                headers["x-mhub-access"] = key;
            }
        }
        else {
            headers["accept"] =
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
        }
        request.headers = headers;
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
export class MangaHubExtension {
    sourceName;
    defaultBaseUrl;
    mangaSource;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
    accessKey = "";
    currentUserAgent = "";
    useReloadKeyParam = false;
    // Index into GRAPHQL_URLS for the endpoint currently in use.
    endpointIndex = 0;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    get graphqlUrl() {
        return GRAPHQL_URLS[this.endpointIndex] ?? GRAPHQL_URLS[0];
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
        this.mangaSource = config.mangaSource;
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new MangaHubInterceptor("main", () => this.baseUrl, () => this.accessKey, () => this.currentUserAgent);
    }
    async getSettingsForm() {
        return new MangaHubSettingsForm(this.sourceName, this.defaultBaseUrl);
    }
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
        // Restore any previously stored access key.
        const stored = Application.getState(ACCESS_KEY_STATE);
        if (typeof stored === "string" && stored.length > 0) {
            this.accessKey = stored;
        }
        const reload = Application.getState(RELOAD_KEY_STATE);
        if (typeof reload === "boolean") {
            this.useReloadKeyParam = reload;
        }
    }
    // ----------------------------------------------------------------
    // GraphQL transport + API key
    // ----------------------------------------------------------------
    /**
     * Fetches a fresh `mhub_access` key by loading a page on the mirror site and
     * reading the `mhub_access` cookie from the response.
     *
     * Mirrors HakuNeko's strategy: rotate the User-Agent, set a plausible
     * `recently` cookie, delete the stale `mhub_access` cookie first so the
     * server is forced to mint a new key, and toggle a `reloadKey` query param
     * across attempts to dodge per-key rate limits.
     */
    async refreshAccessKey(mangaSlug) {
        // Rotate UA on each refresh.
        this.currentUserAgent =
            USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        const previousKey = this.findStoredCookieKey();
        // Drop the stale key cookie so a fresh one is issued.
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            if (cookie.name === "mhub_access") {
                this.cookieStorageInterceptor.deleteCookie(cookie);
            }
        }
        // Plant a believable "recently read" cookie like the website would.
        const now = Date.now();
        const recentlyValue = encodeURIComponent(`{"${now - this.randomInteger(0, 1200)}":{"mangaID":${this.randomInteger(1, 30000)},"number":1}}`);
        this.cookieStorageInterceptor.setCookie({
            name: "recently",
            value: recentlyValue,
            domain: this.cookieDomain(),
            path: "/",
        });
        let path = mangaSlug
            ? `${this.baseUrl}/manga/${mangaSlug}`
            : `${this.baseUrl}/`;
        if (this.useReloadKeyParam) {
            path += path.includes("?") ? "&reloadKey=1" : "?reloadKey=1";
        }
        const [response] = await Application.scheduleRequest({
            url: path,
            method: "GET",
        });
        let key = "";
        for (const cookie of response.cookies ?? []) {
            if (cookie.name === "mhub_access" && cookie.value) {
                key = cookie.value;
                break;
            }
        }
        if (!key) {
            key = this.findStoredCookieKey();
        }
        // If nothing changed, flip the reloadKey param so the next attempt asks
        // the server for a genuinely fresh key.
        if (!key || key === previousKey) {
            this.useReloadKeyParam = !this.useReloadKeyParam;
            Application.setState(this.useReloadKeyParam, RELOAD_KEY_STATE);
        }
        if (key) {
            this.accessKey = key;
            Application.setState(key, ACCESS_KEY_STATE);
        }
    }
    findStoredCookieKey() {
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            if (cookie.name === "mhub_access" && cookie.value) {
                return cookie.value;
            }
        }
        return "";
    }
    randomInteger(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    cookieDomain() {
        return this.baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    }
    /**
     * Performs a GraphQL query against the shared backend. Retries up to 3 times
     * on rate-limit / api-key errors, refreshing the key (and toggling the
     * reloadKey param / falling back to the secondary endpoint) between attempts.
     */
    async graphQL(query, mangaSlug) {
        if (!this.accessKey) {
            await this.refreshAccessKey(mangaSlug);
        }
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            const result = await this.postGraphQL(query);
            const errorText = this.gqlErrorText(result);
            const rateLimited = /rate\s*limit|api\s*key/.test(errorText);
            if (!errorText) {
                return result;
            }
            if (rateLimited) {
                lastError = new Error(errorText);
                // On the second failure, try the alternate endpoint as well.
                if (attempt >= 1 && GRAPHQL_URLS.length > 1) {
                    this.endpointIndex =
                        (this.endpointIndex + 1) % GRAPHQL_URLS.length;
                }
                await this.refreshAccessKey(mangaSlug);
                continue;
            }
            // Non-rate-limit GraphQL error: surface immediately.
            throw new Error(errorText);
        }
        throw lastError ?? new Error("MangaHub: request failed");
    }
    gqlErrorText(result) {
        if (result.errors && result.errors.length > 0) {
            return result.errors
                .map((e) => e.message ?? "")
                .join(" ")
                .toLowerCase()
                .trim();
        }
        return "";
    }
    async postGraphQL(query) {
        const [response, data] = await Application.scheduleRequest({
            url: this.graphqlUrl,
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({ query }),
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const jsonStr = Application.arrayBufferToUTF8String(data);
        try {
            return JSON.parse(jsonStr);
        }
        catch {
            return {};
        }
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
        let order;
        let itemType;
        switch (section.id) {
            case "popular_section":
                order = "POPULAR";
                itemType = "featuredCarouselItem";
                break;
            case "latest_section":
                order = "LATEST";
                itemType = "simpleCarouselItem";
                break;
            default:
                return { items: [] };
        }
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const rows = await this.runSearch("", "all", order, page);
        const items = [];
        for (const row of rows) {
            const slug = row.slug ?? "";
            const imageUrl = this.thumbUrl(row.image);
            // Paperback rejects carousel items with an empty imageUrl
            // ("Invalid URL: "), so skip rows without a usable slug/image.
            if (!slug || !imageUrl)
                continue;
            items.push({
                type: itemType,
                mangaId: this.toSafeId(slug),
                imageUrl,
                title: row.title ?? "",
                metadata: undefined,
            });
        }
        const hasNextPage = rows.length === PER_PAGE;
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
            { id: "POPULAR", label: "Popular" },
            { id: "LATEST", label: "Updates" },
            { id: "ALPHABET", label: "A-Z" },
            { id: "NEW", label: "New" },
            { id: "COMPLETED", label: "Completed" },
        ];
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new MangaHubSearchForm(meta);
    }
    async getSearchResults(query, metadata, sortingOption) {
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const sortId = sortingOption?.id ?? "";
        const filterOrderBy = searchMeta?.orderBy?.[0] ?? "";
        const order = sortId || filterOrderBy || "POPULAR";
        const genre = (searchMeta?.genre ?? "").trim() || "all";
        const rows = await this.runSearch(titleQuery, genre, order, page);
        const seen = new Set();
        const results = [];
        for (const row of rows) {
            // Dedup near-identical entries by author+latestChapter+genres.
            const signature = `${row.author ?? ""}|${row.latestChapter ?? ""}|${row.genres ?? ""}`;
            if (seen.has(signature))
                continue;
            seen.add(signature);
            const slug = row.slug ?? "";
            const imageUrl = this.thumbUrl(row.image);
            if (!slug || !imageUrl)
                continue;
            results.push({
                mangaId: this.toSafeId(slug),
                imageUrl,
                title: row.title ?? "",
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const hasNextPage = rows.length === PER_PAGE;
        const reachedPageLimit = page >= MangaHubExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
        };
    }
    async runSearch(queryText, genre, order, page) {
        const offset = (page - 1) * PER_PAGE;
        const gql = `{
      search(x:${this.mangaSource},q:${JSON.stringify(queryText)},genre:${JSON.stringify(genre)},mod:${order},offset:${offset}) {
        rows { title author slug image genres latestChapter }
      }
    }`;
        const result = await this.graphQL(gql);
        return result.data?.search?.rows ?? [];
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.slugFromId(mangaId);
        const gql = `{
      manga(x:${this.mangaSource},slug:${JSON.stringify(slug)}) {
        title slug status image author artist genres description alternativeTitle
      }
    }`;
        const result = await this.graphQL(gql, slug);
        const manga = result.data?.manga ?? {};
        const secondaryTitles = [];
        if (manga.alternativeTitle && manga.alternativeTitle.trim()) {
            secondaryTitles.push(manga.alternativeTitle.trim());
        }
        const genres = (manga.genres ?? "")
            .split(",")
            .map((g) => g.trim())
            .filter((g) => g.length > 0);
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
        let synopsis = manga.description ?? "";
        if (manga.alternativeTitle && manga.alternativeTitle.trim()) {
            synopsis = `${synopsis}\n\nAlternative Name: ${manga.alternativeTitle.trim()}`;
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: manga.title ?? "",
                secondaryTitles,
                thumbnailUrl: this.thumbUrl(manga.image),
                author: this.cleanField(manga.author),
                artist: this.cleanField(manga.artist),
                synopsis: synopsis.trim(),
                contentRating: this.contentRating,
                status: this.parseStatus(manga.status ?? ""),
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
        const gql = `{
      manga(x:${this.mangaSource},slug:${JSON.stringify(slug)}) {
        slug chapters { number title date }
      }
    }`;
        const result = await this.graphQL(gql, slug);
        const manga = result.data?.manga ?? {};
        const useGeneric = getUseGenericTitle(this.sourceName);
        const list = [...(manga.chapters ?? [])];
        // Source order is ascending; Paperback expects newest first.
        list.reverse();
        const chapters = [];
        for (const ch of list) {
            const numberString = this.formatNumber(ch.number);
            const chapterId = this.toSafeId(`${slug}/chapter-${numberString}`);
            let title;
            if (useGeneric) {
                title = `Chapter ${numberString}`;
            }
            else if (ch.title && /\d/.test(ch.title)) {
                title = ch.title;
            }
            else if (ch.title && ch.title.trim()) {
                title = `Chapter ${numberString} - ${ch.title.trim()}`;
            }
            else {
                title = `Chapter ${numberString}`;
            }
            chapters.push({
                chapterId,
                sourceManga,
                title,
                volume: 0,
                chapNum: ch.number,
                publishDate: this.parseDate(ch.date),
                langCode: this.langCode,
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const parts = decoded.split("/");
        const slug = parts[0];
        const numberSegment = parts[parts.length - 1];
        const number = parseFloat(numberSegment.replace(/^chapter-/, "")) || 0;
        const gql = `{
      chapter(x:${this.mangaSource},slug:${JSON.stringify(slug)},number:${number}) {
        pages mangaID number manga { slug }
      }
    }`;
        const result = await this.graphQL(gql, slug);
        const pagesField = result.data?.chapter?.pages;
        const pages = [];
        if (pagesField) {
            try {
                const payload = JSON.parse(pagesField);
                const prefix = payload.p ?? "";
                for (const img of payload.i ?? []) {
                    pages.push(`${IMAGE_CDN}/${prefix}${img}`);
                }
            }
            catch {
                // pages field was not valid JSON; leave empty.
            }
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const slug = this.slugFromId(mangaId);
        return `${this.baseUrl}/manga/${slug}`;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    thumbUrl(image) {
        if (!image)
            return "";
        if (/^https?:\/\//.test(image))
            return image;
        return `${THUMB_CDN}/${image}`;
    }
    formatNumber(num) {
        return Number.isInteger(num) ? String(num) : String(num);
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
    parseStatus(status) {
        switch (status.toLowerCase()) {
            case "ongoing":
                return "Ongoing";
            case "completed":
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
    // Cloudflare
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
}
