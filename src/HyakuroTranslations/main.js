import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://hyakuro.net";
const API_URL = `${BASE_URL}/backend/api`;
const CATEGORIES = [
    "Action",
    "Adult",
    "Adventure",
    "Comedy",
    "Doujinshi",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Gender Bender",
    "Harem",
    "Hentai",
    "Historical",
    "Horror",
    "Josei",
    "Lolicon",
    "Martial Arts",
    "Mature",
    "Mecha",
    "Mystery",
    "Psychological",
    "Romance",
    "School Life",
    "Sci-fi",
    "Seinen",
    "Shotacon",
    "Shoujo",
    "Shoujo Ai",
    "Shounen",
    "Shounen Ai",
    "Slice of Life",
    "Smut",
    "Sports",
    "Supernatural",
    "Tragedy",
    "Webtoon",
    "Yaoi",
    "Yuri",
];
class HyakuroTranslationsInterceptor extends PaperbackInterceptor {
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
export class HyakuroTranslationsExtension {
    requestManager = new HyakuroTranslationsInterceptor("main");
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
                title: "Popular (A-Z)",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "genres",
                title: "Categories",
                type: DiscoverSectionType.genres,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id === "genres") {
            const items = CATEGORIES.map((genre) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre },
                },
                name: genre,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "Title:asc" : "updatedAt:desc";
        const params = [
            `populate=${encodeURIComponent("Cover,Chapters")}`,
            `sort=${encodeURIComponent(sort)}`,
            `pagination[page]=${page}`,
        ];
        const url = `${API_URL}/mangas?${params.join("&")}`;
        const result = await this.fetchJson({
            url,
            method: "GET",
        });
        const items = [];
        for (const entry of result.data ?? []) {
            const parsed = this.itemFromAttributes(entry.attributes);
            if (!parsed)
                continue;
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        }
        const pagination = result.meta?.pagination;
        const hasNextPage = pagination
            ? pagination.page < pagination.pageCount
            : false;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const filterMeta = query.metadata;
        const params = [
            `pagination[page]=${page}`,
            `populate=${encodeURIComponent("Cover,Chapters")}`,
            `sort=${encodeURIComponent("updatedAt:desc")}`,
        ];
        if (titleQuery) {
            params.push(`${encodeURIComponent("filters[Title][$containsi]")}=${encodeURIComponent(titleQuery)}`);
        }
        const genre = filterMeta?.genre;
        if (genre) {
            if (genre === "Oneshot") {
                params.push(`${encodeURIComponent("filters[Oneshot][$eq]")}=true`);
            }
            else {
                params.push(`${encodeURIComponent("filters[$and][1][Categories][$containsi]")}=${encodeURIComponent(genre)}`);
            }
        }
        const url = `${API_URL}/mangas?${params.join("&")}`;
        const result = await this.fetchJson({
            url,
            method: "GET",
        });
        const items = [];
        for (const entry of result.data ?? []) {
            const parsed = this.itemFromAttributes(entry.attributes);
            if (!parsed)
                continue;
            items.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const pagination = result.meta?.pagination;
        const hasNextPage = pagination
            ? pagination.page < pagination.pageCount
            : false;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const attributes = await this.fetchMangaAttributes(slug);
        const title = attributes.Title || slug;
        const thumbnailUrl = attributes.Cover?.data?.attributes?.url
            ? `${BASE_URL}/backend${attributes.Cover.data.attributes.url}`
            : "";
        const categories = attributes.Categories ?? [];
        const extraTags = [];
        if (attributes.Longstrip === true)
            extraTags.push("Longstrip");
        if (attributes.Oneshot === true)
            extraTags.push("Oneshot");
        const allTags = [...categories, ...extraTags].filter((g) => typeof g === "string" && g.length > 0);
        const tagGroups = [];
        if (allTags.length > 0) {
            tagGroups.push({
                id: "categories",
                title: "Categories",
                tags: allTags.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: attributes.Author ?? undefined,
                artist: attributes.Artist ?? undefined,
                synopsis: attributes.Synopsis ?? "",
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(attributes.Status),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const attributes = await this.fetchMangaAttributes(slug);
        const oneshot = attributes.Oneshot === true;
        const apiChapters = (attributes.Chapters ?? [])
            .slice()
            .sort((a, b) => (b.Chapter ?? 0) - (a.Chapter ?? 0));
        const chapters = [];
        for (const ch of apiChapters) {
            if (ch.id == null || ch.Chapter == null)
                continue;
            const chapNum = ch.Chapter;
            const chapterStr = String(chapNum);
            let name;
            const t = ch.Title;
            if (t == null && oneshot)
                name = "Oneshot";
            else if (t == null && !oneshot)
                name = `Chapter ${chapterStr}`;
            else if (t != null && oneshot)
                name = `Oneshot - ${t}`;
            else if (t != null && !oneshot)
                name = `Chapter ${chapterStr} - ${t}`;
            else
                name = `Chapter ${chapterStr}`;
            const dateStr = ch.TranslatedOn ?? attributes.publishedAt ?? null;
            const publishDate = this.parseDate(dateStr);
            // chapterId encodes slug, chapter number, and chapter id
            const chapterId = this.toSafeId(`${slug}#${chapNum}#${ch.id}`);
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum,
                publishDate,
                langCode: "🇬🇧",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const parts = decoded.split("#");
        const slug = parts[0];
        const chapterId = parseInt(parts[2] ?? "", 10);
        const params = [
            `${encodeURIComponent("filters[slug][$eq]")}=${encodeURIComponent(slug)}`,
            `${encodeURIComponent("populate[Chapters][populate]")}=*`,
        ];
        const url = `${API_URL}/mangas?${params.join("&")}`;
        const result = await this.fetchJson({
            url,
            method: "GET",
        });
        const attributes = result.data?.[0]?.attributes;
        const apiChapter = (attributes?.Chapters ?? []).find((c) => c.id === chapterId);
        const pageData = (apiChapter?.Pages?.data ?? [])
            .slice()
            .sort((a, b) => (a.attributes?.url ?? "").localeCompare(b.attributes?.url ?? ""));
        const pages = [];
        for (const p of pageData) {
            const u = p.attributes?.url;
            if (u)
                pages.push(`${BASE_URL}/backend${u}`);
        }
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
    async fetchMangaAttributes(slug) {
        const params = [
            `${encodeURIComponent("filters[slug][$eq]")}=${encodeURIComponent(slug)}`,
            `populate=${encodeURIComponent("Cover,Chapters")}`,
        ];
        const url = `${API_URL}/mangas?${params.join("&")}`;
        const result = await this.fetchJson({
            url,
            method: "GET",
        });
        const attributes = result.data?.[0]?.attributes;
        if (!attributes) {
            throw new Error("Content not found");
        }
        return attributes;
    }
    itemFromAttributes(attributes) {
        if (!attributes || !attributes.slug)
            return undefined;
        const mangaId = this.toSafeId(attributes.slug);
        const title = attributes.Title || attributes.slug;
        const imageUrl = attributes.Cover?.data?.attributes?.url
            ? `${BASE_URL}/backend${attributes.Cover.data.attributes.url}`
            : "";
        return { mangaId, imageUrl, title };
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
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
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("dropped"))
            return "Cancelled";
        return "Unknown";
    }
    parseDate(dateStr) {
        if (!dateStr)
            return new Date(0);
        const t = Date.parse(dateStr);
        if (Number.isNaN(t))
            return new Date(0);
        return new Date(t);
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
export const HyakuroTranslations = new HyakuroTranslationsExtension();
