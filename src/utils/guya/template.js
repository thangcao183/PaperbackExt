import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { URLBuilder } from "../url-builder/base";
import { getBaseUrlOverride, GuyaSettingsForm } from "./settings";
class GuyaInterceptor extends PaperbackInterceptor {
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
export class GuyaExtension {
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
        this.requestManager = new GuyaInterceptor("main", () => this.baseUrl);
    }
    async getSettingsForm() {
        return new GuyaSettingsForm(this.sourceName, this.defaultBaseUrl);
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
                title: "All Series",
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
        const all = await this.fetchAllSeries();
        let entries = Object.entries(all);
        if (section.id === "latest_section") {
            entries = entries.sort((a, b) => (b[1].last_updated ?? 0) - (a[1].last_updated ?? 0));
        }
        const itemType = section.id === "popular_section"
            ? "featuredCarouselItem"
            : "simpleCarouselItem";
        const items = entries.map(([title, series]) => ({
            type: itemType,
            mangaId: this.toSafeId(series.slug ?? title),
            imageUrl: this.resolveCover(series.cover),
            title: series.title ?? title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search (client-side filter of the full series list)
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const all = await this.fetchAllSeries();
        const results = [];
        for (const [title, series] of Object.entries(all)) {
            const displayTitle = series.title ?? title;
            if (titleQuery && !displayTitle.toLowerCase().includes(titleQuery)) {
                continue;
            }
            results.push({
                mangaId: this.toSafeId(series.slug ?? title),
                imageUrl: this.resolveCover(series.cover),
                title: displayTitle,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        return { items: results, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const series = await this.fetchSeries(slug);
        const description = this.stripHtml(series.description ?? "");
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title ?? slug,
                secondaryTitles: [],
                thumbnailUrl: this.resolveCover(series.cover),
                author: series.author || undefined,
                artist: series.artist || undefined,
                synopsis: description,
                contentRating: this.contentRating,
                status: "Unknown",
                tagGroups: [],
                shareUrl: this.getMangaShareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const series = await this.fetchSeries(slug);
        const chaptersObj = series.chapters ?? {};
        const chapters = [];
        for (const [num, chapter] of Object.entries(chaptersObj)) {
            const chapNum = parseFloat(num);
            const groupId = this.pickGroup(chapter);
            const releaseDate = chapter.release_date?.[groupId];
            const title = chapter.title
                ? `${num} - ${chapter.title}`
                : `Chapter ${num}`;
            chapters.push({
                chapterId: this.toSafeId(`${slug}/${num}`),
                sourceManga,
                title,
                volume: 0,
                chapNum: isNaN(chapNum) ? 0 : chapNum,
                publishDate: releaseDate ? new Date(releaseDate * 1000) : new Date(),
                langCode: this.langCode,
            });
        }
        // Source lists chapters ascending; present newest first.
        chapters.sort((a, b) => b.chapNum - a.chapNum);
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const slug = decoded.split("/")[0];
        const num = decoded.split("/")[1];
        const series = await this.fetchSeries(slug);
        const chapterData = series.chapters?.[num];
        const pages = [];
        if (chapterData) {
            const groupId = this.pickGroup(chapterData);
            const folder = chapterData.folder ?? "";
            const files = chapterData.groups?.[groupId] ?? [];
            for (const file of files) {
                if (typeof file === "string" && file.startsWith("http")) {
                    pages.push(file);
                }
                else {
                    pages.push(`${this.baseUrl}/media/manga/${slug}/chapters/${folder}/${groupId}/${file}`);
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
        return new URLBuilder(this.baseUrl)
            .addPath("reader")
            .addPath("series")
            .addPath(this.safeDecode(mangaId))
            .build();
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    async fetchAllSeries() {
        const url = new URLBuilder(this.baseUrl)
            .addPath("api")
            .addPath("get_all_series")
            .build();
        return this.fetchJson({ url, method: "GET" });
    }
    async fetchSeries(slug) {
        const url = new URLBuilder(this.baseUrl)
            .addPath("api")
            .addPath("series")
            .addPath(slug)
            .build();
        return this.fetchJson({ url, method: "GET" });
    }
    pickGroup(chapter) {
        if (chapter.preferred_sort && chapter.preferred_sort.length > 0) {
            const preferred = chapter.preferred_sort.find((g) => chapter.groups && chapter.groups[g]);
            if (preferred)
                return preferred;
        }
        const groupKeys = Object.keys(chapter.groups ?? {});
        return groupKeys[0] ?? "";
    }
    resolveCover(cover) {
        if (!cover)
            return "";
        if (cover.startsWith("http"))
            return cover;
        return cover.startsWith("/")
            ? `${this.baseUrl}${cover}`
            : `${this.baseUrl}/${cover}`;
    }
    stripHtml(html) {
        return html
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .trim();
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
}
