import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { BakkinSettingsForm, getBaseUrlOverride, getFullsizeImages, } from "./settings";
class BakkinInterceptor extends PaperbackInterceptor {
    getBaseUrl;
    constructor(id, getBaseUrl) {
        super(id);
        this.getBaseUrl = getBaseUrl;
    }
    async interceptRequest(request) {
        const baseUrl = this.getBaseUrl();
        request.headers = {
            ...request.headers,
            referer: baseUrl,
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
export class BakkinExtension {
    sourceName;
    defaultBaseUrl;
    contentRating;
    langCode;
    // Cache the single catalog blob across calls within a session.
    seriesCache;
    // baseUrl keeps a trailing slash because "main.php" is appended directly.
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
        // Ensure exactly one trailing slash.
        this.defaultBaseUrl = `${config.baseUrl.replace(/\/+$/, "")}/`;
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new BakkinInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new BakkinSettingsForm(this.sourceName, this.defaultBaseUrl);
    }
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    // ----------------------------------------------------------------
    // Catalog fetching (single blob, cached)
    // ----------------------------------------------------------------
    async fetchCatalog() {
        if (this.seriesCache)
            return this.seriesCache;
        const quality = getFullsizeImages(this.sourceName) ? "?fullsize" : "";
        const url = `${this.baseUrl}main.php${quality}`;
        const blob = await this.fetchJson({
            url,
            method: "GET",
        });
        const series = Object.values(blob ?? {}).filter((s) => s && typeof s.dir === "string");
        this.seriesCache = series;
        return series;
    }
    seriesTitle(series) {
        const name = (series.name ?? "").trim();
        return name.length > 0 ? name : series.dir;
    }
    nodeTitle(node) {
        const name = (node.name ?? "").trim();
        return name.length > 0 ? name : node.dir;
    }
    coverUrl(series) {
        const cover = (series.thumb ?? "").trim() || "static/nocover.png";
        return `${this.baseUrl}${cover}`;
    }
    // ----------------------------------------------------------------
    // Discover sections
    // ----------------------------------------------------------------
    async getDiscoverSections() {
        return [
            {
                id: "all_titles",
                title: "All Titles",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(section, _metadata) {
        if (section.id !== "all_titles")
            return { items: [] };
        const series = await this.fetchCatalog();
        const items = series.map((s) => ({
            type: "featuredCarouselItem",
            mangaId: this.toSafeId(s.dir),
            imageUrl: this.coverUrl(s),
            title: this.seriesTitle(s),
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search (client-side filter over the cached catalog)
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const series = await this.fetchCatalog();
        const filtered = titleQuery.length > 0
            ? series.filter((s) => this.seriesTitle(s).toLowerCase().includes(titleQuery))
            : series;
        const results = filtered.map((s) => ({
            mangaId: this.toSafeId(s.dir),
            imageUrl: this.coverUrl(s),
            title: this.seriesTitle(s),
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items: results, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const dir = this.safeDecode(mangaId);
        const series = await this.fetchCatalog();
        const found = series.find((s) => s.dir === dir);
        if (!found) {
            throw new Error(`Series not found: ${dir}`);
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: this.seriesTitle(found),
                secondaryTitles: [],
                thumbnailUrl: this.coverUrl(found),
                author: this.cleanField(found.author),
                artist: undefined,
                synopsis: "",
                contentRating: this.contentRating,
                status: this.parseStatus(found.status),
                tagGroups: [],
                shareUrl: this.getMangaShareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const dir = this.safeDecode(sourceManga.mangaId);
        const series = await this.fetchCatalog();
        const found = series.find((s) => s.dir === dir);
        if (!found)
            return [];
        const chapters = [];
        for (const volume of found.volumes ?? []) {
            for (const chapter of volume.chapters ?? []) {
                const composite = `${found.dir}/${volume.dir}/${chapter.dir}`;
                const name = `${this.nodeTitle(volume)} - ${this.nodeTitle(chapter)}`;
                chapters.push({
                    chapterId: this.toSafeId(composite),
                    sourceManga,
                    title: name,
                    volume: 0,
                    chapNum: this.parseChapterNumber(chapter.dir),
                    publishDate: new Date(0),
                    langCode: this.langCode,
                });
            }
        }
        // Source lists chapters oldest-first; present newest-first.
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const composite = this.safeDecode(chapter.chapterId);
        const series = await this.fetchCatalog();
        let pages = [];
        outer: for (const s of series) {
            for (const volume of s.volumes ?? []) {
                for (const ch of volume.chapters ?? []) {
                    const candidate = `${s.dir}/${volume.dir}/${ch.dir}`;
                    if (candidate === composite) {
                        pages = (ch.pages ?? []).map((p) => `${this.baseUrl}${p}`);
                        break outer;
                    }
                }
            }
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const dir = this.safeDecode(mangaId);
        return `${this.baseUrl}#m=${dir}`;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    parseChapterNumber(chapterDir) {
        // Chapter dirs look like "...c001"; number follows the last 'c'.
        const idx = chapterDir.lastIndexOf("c");
        if (idx >= 0) {
            const num = parseFloat(chapterDir.substring(idx + 1));
            if (!isNaN(num))
                return num;
        }
        const fallback = chapterDir.match(/(\d+(\.\d+)?)/);
        return fallback ? parseFloat(fallback[1]) : -1;
    }
    parseStatus(status) {
        switch ((status ?? "").toLowerCase()) {
            case "ongoing":
                return "Ongoing";
            case "completed":
                return "Completed";
            default:
                return "Unknown";
        }
    }
    cleanField(value) {
        const trimmed = (value ?? "").trim();
        if (trimmed.length === 0 ||
            trimmed === "-" ||
            trimmed.toLowerCase() === "n/a") {
            return undefined;
        }
        return trimmed;
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
