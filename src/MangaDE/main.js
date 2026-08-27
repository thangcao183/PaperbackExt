import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://mangade.io";
const API_URL = "https://api.mangade.io/api";
const PAGE_SIZE = 20;
class MangaDEInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json, text/plain, */*",
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
export class MangaDEExtension {
    requestManager = new MangaDEInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
        bufferInterval: 1,
        ignoreImages: true,
    });
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
                id: "most-viewed",
                title: "Most Viewed",
                type: DiscoverSectionType.featured,
            },
            {
                id: "newest",
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
            const genres = await this.fetchGenres();
            const items = genres.map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre: g.id },
                },
                name: g.name,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "newest" ? "newest" : "most-viewed";
        const url = `${API_URL}/comics?page=${page}&size=${PAGE_SIZE}&sort=${sort}`;
        const payload = await this.fetchJson(url);
        const list = payload.data.list ?? [];
        const items = list.map((m) => ({
            type: section.id === "newest" ? "simpleCarouselItem" : "featuredCarouselItem",
            mangaId: this.buildMangaId(m),
            imageUrl: this.absoluteUrl(m.image),
            title: m.name,
            metadata: undefined,
        }));
        const hasNext = this.hasNextPage(payload.data);
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const queryMeta = query.metadata;
        const genre = meta?.genre ?? queryMeta?.genre;
        const params = [];
        params.push(`page=${page}`);
        params.push(`size=${PAGE_SIZE}`);
        if (titleQuery)
            params.push(`name=${encodeURIComponent(titleQuery)}`);
        if (genre)
            params.push(`genres[]=${encodeURIComponent(genre)}`);
        const url = `${API_URL}/comics?${params.join("&")}`;
        const payload = await this.fetchJson(url);
        const list = payload.data.list ?? [];
        const results = list.map((m) => ({
            mangaId: this.buildMangaId(m),
            imageUrl: this.absoluteUrl(m.image),
            title: m.name,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNext = this.hasNextPage(payload.data);
        return {
            items: results,
            metadata: hasNext ? { page: page + 1, genre } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const id = this.mangaApiId(mangaId);
        const url = `${API_URL}/comics/${id}/view`;
        const payload = await this.fetchJson(url);
        const m = payload.data;
        const tagGroups = [];
        const genreNames = (m.genre_names || "")
            .split(",")
            .map((g) => g.trim())
            .filter((g) => g.length > 0);
        if (genreNames.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genreNames.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: m.name,
                secondaryTitles: [],
                thumbnailUrl: this.absoluteUrl(m.image),
                synopsis: m.description || "",
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(m.status),
                tagGroups,
                shareUrl: this.getMangaShareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const id = this.mangaApiId(sourceManga.mangaId);
        const slug = this.mangaSlug(sourceManga.mangaId);
        const url = `${API_URL}/comics/${id}/view`;
        const payload = await this.fetchJson(url);
        const newsChapters = payload.data.news_chapters ?? [];
        const chapters = [];
        const seen = new Set();
        for (const c of newsChapters) {
            const chapterId = this.buildChapterId(c, id, slug);
            if (seen.has(chapterId))
                continue;
            seen.add(chapterId);
            const chapNum = c.chapter_number ? parseFloat(c.chapter_number) : -1;
            chapters.push({
                chapterId,
                sourceManga,
                title: c.name,
                volume: 0,
                chapNum: Number.isNaN(chapNum) ? -1 : chapNum,
                publishDate: this.parseDate(c.published_date),
                langCode: "🇬🇧",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const cid = this.chapterApiId(chapter.chapterId);
        const url = `${API_URL}/chapters/${cid}/view`;
        const payload = await this.fetchJson(url);
        const images = payload.data.chapter_images ?? [];
        const pages = images
            .map((p) => this.absoluteUrl(p.image))
            .filter((p) => p.length > 0);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const id = this.mangaApiId(mangaId);
        const slug = this.mangaSlug(mangaId);
        return `${BASE_URL}/comic/${slug}-pid${id}`;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    async fetchGenres() {
        try {
            const url = `${API_URL}/genres?size=500`;
            const payload = await this.fetchJson(url);
            return payload.data.genres ?? [];
        }
        catch {
            return [];
        }
    }
    // mangaId encodes "<slug>?mid=<id>" so both the API id and slug round-trip.
    buildMangaId(m) {
        const slug = m.slug || m.id;
        return this.toSafeId(`${slug}?mid=${m.id}`);
    }
    mangaApiId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const m = decoded.match(/mid=([^&]+)/);
        if (m)
            return m[1];
        // Fallback: trailing path may itself be an id
        return decoded.replace(/\?.*$/, "");
    }
    mangaSlug(mangaId) {
        const decoded = this.safeDecode(mangaId);
        return decoded.replace(/\?.*$/, "").replace(/^\/+/, "");
    }
    // chapterId encodes "<mangaSlug>/<chapterSlug>?cid=<id>&mid=<mangaId>"
    buildChapterId(c, mangaId, mangaSlug) {
        const chapterSlug = c.slug || c.id;
        return this.toSafeId(`${mangaSlug}/${chapterSlug}?cid=${c.id}&mid=${mangaId}`);
    }
    chapterApiId(chapterId) {
        const decoded = this.safeDecode(chapterId);
        const m = decoded.match(/cid=([^&]+)/);
        if (m)
            return m[1];
        return decoded.replace(/\?.*$/, "");
    }
    parseStatus(status) {
        switch (status) {
            case "Ongoing":
            case "Releasing":
                return "Ongoing";
            case "Completed":
                return "Completed";
            case "On Hiatus":
                return "Hiatus";
            default:
                return "Unknown";
        }
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        // Upstream format: "yyyy-MM-dd HH:mm:ss"
        const iso = value.trim().replace(" ", "T");
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime()))
            return d;
        const d2 = new Date(value);
        return Number.isNaN(d2.getTime()) ? new Date(0) : d2;
    }
    hasNextPage(data) {
        const current = parseInt(data.page, 10);
        if (Number.isNaN(current))
            return false;
        return current < data.totalPage;
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
    async fetchJson(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
}
export const MangaDE = new MangaDEExtension();
