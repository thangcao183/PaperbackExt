import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { getApiUrlOverride, getBaseUrlOverride, MonochromeSettingsForm, } from "./settings";
class MonochromeInterceptor extends PaperbackInterceptor {
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
export class MonochromeExtension {
    sourceName;
    defaultBaseUrl;
    defaultApiUrl;
    contentRating;
    langCode;
    static MAX_SEARCH_PAGES = 5;
    static PER_PAGE = 10;
    get baseUrl() {
        return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
    }
    get apiUrl() {
        return getApiUrlOverride(this.sourceName) ?? this.defaultApiUrl;
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
        this.defaultApiUrl = (config.apiUrl ?? this.deriveApiUrl(config.baseUrl)).replace(/\/+$/, "");
        this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
        this.langCode = config.langCode ?? "🇬🇧";
        this.requestManager = new MonochromeInterceptor("main", () => this.baseUrl);
    }
    deriveApiUrl(baseUrl) {
        return baseUrl.replace(/^(https?:\/\/)/, "$1api.");
    }
    async getSettingsForm() {
        return new MonochromeSettingsForm(this.sourceName, this.defaultBaseUrl, this.defaultApiUrl);
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
        // Monochrome has no "latest" feed; only a title listing is available.
        return [
            {
                id: "popular_section",
                title: "All Titles",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id !== "popular_section") {
            return { items: [] };
        }
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const { mangas, total } = await this.fetchMangaList("", page);
        const items = mangas.map((manga) => ({
            type: "featuredCarouselItem",
            mangaId: this.toSafeId(manga.id),
            imageUrl: this.coverUrl(manga),
            title: manga.title,
            metadata: undefined,
        }));
        const hasNextPage = page * MonochromeExtension.PER_PAGE < total;
        const reachedPageLimit = page >= MonochromeExtension.MAX_SEARCH_PAGES;
        return {
            items,
            metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const titleQuery = (query.title || "").trim();
        const page = typeof metadata?.page === "number"
            ? metadata.page
            : 1;
        const { mangas, total } = await this.fetchMangaList(titleQuery, page);
        const results = mangas.map((manga) => ({
            mangaId: this.toSafeId(manga.id),
            imageUrl: this.coverUrl(manga),
            title: manga.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = page * MonochromeExtension.PER_PAGE < total;
        const reachedPageLimit = page >= MonochromeExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
        };
    }
    async fetchMangaList(title, page) {
        const offset = (page - 1) * MonochromeExtension.PER_PAGE;
        const builder = new URLBuilder(this.apiUrl)
            .addPath("manga")
            .addQuery("limit", MonochromeExtension.PER_PAGE.toString())
            .addQuery("offset", offset.toString());
        if (title)
            builder.addQuery("title", title);
        const data = await this.fetchJson({
            url: builder.build(),
            method: "GET",
        });
        return {
            mangas: data.results ?? [],
            total: data.total ?? 0,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const uuid = this.safeDecode(mangaId);
        const url = new URLBuilder(this.apiUrl)
            .addPath("manga")
            .addPath(uuid)
            .build();
        const manga = await this.fetchJson({
            url,
            method: "GET",
        });
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: manga.title,
                secondaryTitles: [],
                thumbnailUrl: this.coverUrl(manga),
                author: this.cleanField(manga.author),
                artist: this.cleanField(manga.artist),
                synopsis: this.stripHtml(manga.description ?? ""),
                contentRating: this.contentRating,
                status: this.parseStatus(manga.status ?? ""),
                tagGroups: [],
                shareUrl: this.getMangaShareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const uuid = this.safeDecode(sourceManga.mangaId);
        const url = new URLBuilder(this.apiUrl)
            .addPath("manga")
            .addPath(uuid)
            .addPath("chapters")
            .build();
        const data = await this.fetchJson({
            url,
            method: "GET",
        });
        const chapters = [];
        for (const ch of data ?? []) {
            // Composite id encodes everything needed to build the page URLs:
            //   {mangaUuid}/{chapterId}|{version}|{length}
            const chapterId = this.toSafeId(`${uuid}/${ch.id}|${ch.version}|${ch.length}`);
            chapters.push({
                chapterId,
                sourceManga,
                title: this.buildChapterName(ch),
                volume: ch.volume ?? 0,
                chapNum: typeof ch.number === "number" && !isNaN(ch.number) ? ch.number : -1,
                publishDate: this.parseDate(ch.uploadTime ?? ""),
                langCode: this.langCode,
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const composite = this.safeDecode(chapter.chapterId);
        const parts = composite.split("|");
        const mediaPath = parts[0]; // {mangaUuid}/{chapterId}
        const version = parts[1] ?? "";
        const length = parseInt(parts[2] ?? "0", 10);
        const pages = [];
        for (let i = 1; i <= length; i++) {
            pages.push(`${this.apiUrl}/media/${mediaPath}/${i}.jpg?version=${version}`);
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const uuid = this.safeDecode(mangaId);
        return new URLBuilder(this.baseUrl)
            .addPath("manga")
            .addPath(uuid)
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    coverUrl(manga) {
        const version = manga.version ?? 0;
        return `${this.apiUrl}/media/${manga.id}/cover.jpg?version=${version}`;
    }
    buildChapterName(ch) {
        const num = ch.number;
        const numStr = typeof num === "number" && !isNaN(num) ? String(num) : "";
        const prefix = ch.volume != null ? `Vol ${ch.volume} ` : "";
        const base = numStr ? `${prefix}Chapter ${numStr}` : `${prefix}Chapter`;
        const name = (ch.name ?? "").trim();
        return name ? `${base} - ${name}` : base;
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
        switch (status.toLowerCase()) {
            case "ongoing":
            case "hiatus":
                return "Ongoing";
            case "completed":
            case "cancelled":
            case "canceled":
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
