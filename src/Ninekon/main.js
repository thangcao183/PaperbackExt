import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://app.ninekon.com";
const API_URL = "https://api.ninekon.com/1.0";
const GENRES = [
    { title: "Action", value: "action" },
    { title: "Adult", value: "adult" },
    { title: "Adventure", value: "adventure" },
    { title: "Comedy", value: "comedy" },
    { title: "Cooking", value: "cooking" },
    { title: "Doujinshi", value: "doujinshi" },
    { title: "Drama", value: "drama" },
    { title: "Ecchi", value: "ecchi" },
    { title: "Erotica", value: "erotica" },
    { title: "Fantasy", value: "fantasy" },
    { title: "Gender bender", value: "gender-bender" },
    { title: "Harem", value: "harem" },
    { title: "Historical", value: "historical" },
    { title: "Horror", value: "horror" },
    { title: "Isekai", value: "isekai" },
    { title: "Josei", value: "josei" },
    { title: "Manhua", value: "manhua" },
    { title: "Manhwa", value: "manhwa" },
    { title: "Martial Arts", value: "martial-arts" },
    { title: "Mature", value: "mature" },
    { title: "Mecha", value: "mecha" },
    { title: "Medical", value: "medical" },
    { title: "Mystery", value: "mystery" },
    { title: "One Shot", value: "one-shot" },
    { title: "Psychological", value: "psychological" },
    { title: "Romance", value: "romance" },
    { title: "School Life", value: "school-life" },
    { title: "Sci Fi", value: "sci-fi" },
    { title: "Seinen", value: "seinen" },
    { title: "Shoujo", value: "shoujo" },
    { title: "Shoujo Ai", value: "shoujo-ai" },
    { title: "Shounen", value: "shounen" },
    { title: "Shounen Ai", value: "shounen-ai" },
    { title: "Slice of life", value: "slice-of-life" },
    { title: "Smut", value: "smut" },
    { title: "Sports", value: "sports" },
    { title: "Supernatural", value: "supernatural" },
    { title: "Tragedy", value: "tragedy" },
    { title: "Webtoons", value: "webtoons" },
    { title: "Yaoi", value: "yaoi" },
    { title: "Yuri", value: "yuri" },
];
class NinekonInterceptor extends PaperbackInterceptor {
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
export class NinekonExtension {
    requestManager = new NinekonInterceptor("main");
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
            const items = GENRES.map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre: g.value },
                },
                name: g.title,
                metadata: { genre: g.value },
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sortParam = section.id === "popular" ? "sort=views" : "sort=dt&order=desc";
        const url = `${API_URL}/books?${sortParam}&page=${page}`;
        const data = await this.fetchJSON({ url, method: "GET" });
        const items = (data.books ?? []).map((book) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: this.toSafeId(book.gid),
            imageUrl: this.coverUrl(book),
            title: book.title,
            metadata: undefined,
        }));
        const totalPages = data.pages ?? 0;
        return {
            items,
            metadata: page < totalPages ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const queryMeta = query.metadata;
        const page = meta?.page ?? 1;
        const genre = meta?.genre ?? queryMeta?.genre;
        const titleQuery = (query.title || "").trim();
        const params = [];
        params.push(`page=${page}`);
        if (titleQuery !== "") {
            params.push("field=title");
            params.push(`query=${encodeURIComponent(titleQuery)}`);
        }
        if (genre) {
            params.push(`tags=${encodeURIComponent(genre)}`);
        }
        params.push("sort=dt");
        params.push("order=desc");
        const url = `${API_URL}/books?${params.join("&")}`;
        const data = await this.fetchJSON({ url, method: "GET" });
        const items = (data.books ?? []).map((book) => ({
            mangaId: this.toSafeId(book.gid),
            imageUrl: this.coverUrl(book),
            title: book.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const totalPages = data.pages ?? 0;
        return {
            items,
            metadata: page < totalPages ? { page: page + 1, genre } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const gid = this.safeDecode(mangaId);
        const url = `${API_URL}/books/${gid}`;
        const data = await this.fetchJSON({ url, method: "GET" });
        const genres = (data.tags ?? "")
            .split("|")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
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
                primaryTitle: data.title,
                secondaryTitles: [],
                thumbnailUrl: this.coverUrl(data),
                author: data.author ?? undefined,
                artist: data.author ?? undefined,
                synopsis: data.summary ?? "",
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(data.status),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const gid = this.safeDecode(sourceManga.mangaId);
        const url = `${API_URL}/books/${gid}`;
        const data = await this.fetchJSON({ url, method: "GET" });
        const rawChapters = (data.chapters ?? []).slice().reverse();
        const updatedDate = this.parseDate(data.dt_updated);
        return rawChapters.map((ch, index) => {
            const chapNum = ch.ordinal ?? -1;
            const chapterPath = `/books/${gid}/chapters/${ch.gid}/pages`;
            return {
                chapterId: this.toSafeId(chapterPath),
                sourceManga,
                title: `Chapter ${chapNum >= 0 ? chapNum.toString() : "Unknown"}`,
                volume: 0,
                chapNum,
                publishDate: index === 0 ? updatedDate : new Date(0),
                langCode: "🇬🇧",
            };
        });
    }
    async getChapterDetails(chapter) {
        const path = this.safeDecode(chapter.chapterId);
        const url = `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
        const data = await this.fetchJSON({ url, method: "GET" });
        const host = data.host || "";
        const pages = (data.pages ?? []).map((p) => p.startsWith("http") ? p : `${host}${p}`);
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
        const gid = this.safeDecode(mangaId);
        if (gid.startsWith("http"))
            return gid;
        return `${BASE_URL}/book/${gid.replace(/^\/+/, "")}`;
    }
    coverUrl(book) {
        if (book.host && book.cover) {
            const cover = book.cover;
            return cover.startsWith("http") ? cover : `${book.host}${cover}`;
        }
        return "";
    }
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s === "ongoing")
            return "Ongoing";
        if (s === "completed")
            return "Completed";
        return "Unknown";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        // Format: "yyyy-MM-dd HH:mm:ss"
        const normalized = value.replace(" ", "T");
        const parsed = new Date(normalized);
        return isNaN(parsed.getTime()) ? new Date(0) : parsed;
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
    async fetchJSON(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const jsonStr = Application.arrayBufferToUTF8String(data);
        return JSON.parse(jsonStr);
    }
}
export const Ninekon = new NinekonExtension();
