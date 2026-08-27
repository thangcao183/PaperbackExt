import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://play.mobilelegends.com";
const API_URL = "https://api.mobilelegends.com";
const TYPE_COMIC = 3;
const SORT_NEWEST = 1;
const SORT_POPULARITY = 3;
const PAGE_SIZE = 5;
class MLBBLoreInterceptor extends PaperbackInterceptor {
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
export class MLBBLoreExtension {
    requestManager = new MLBBLoreInterceptor("main");
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
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "latest" ? SORT_NEWEST : SORT_POPULARITY;
        const entries = await this.fetchAlbumList(sort, page);
        const items = entries.map((entry) => ({
            type: section.id === "latest"
                ? "simpleCarouselItem"
                : "featuredCarouselItem",
            mangaId: String(entry.id),
            imageUrl: this.absoluteUrl(entry.thumb ?? ""),
            title: entry.title ?? "",
            subtitle: (entry.hero_name ?? "").trim() || undefined,
            metadata: undefined,
        }));
        const hasNext = entries.length >= PAGE_SIZE;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(_query, metadata) {
        // Upstream search has no real query support; it returns the popular list.
        const meta = metadata;
        const page = meta?.page ?? 1;
        const entries = await this.fetchAlbumList(SORT_POPULARITY, page);
        const results = entries.map((entry) => ({
            mangaId: String(entry.id),
            imageUrl: this.absoluteUrl(entry.thumb ?? ""),
            title: entry.title ?? "",
            subtitle: (entry.hero_name ?? "").trim() || undefined,
            metadata: undefined,
        }));
        const hasNext = entries.length >= PAGE_SIZE;
        return { items: results, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const detail = await this.fetchAlbumDetail(mangaId);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: detail?.title ?? this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl: this.absoluteUrl(detail?.thumb ?? ""),
                author: (detail?.hero_name ?? "").trim(),
                artist: (detail?.hero_name ?? "").trim(),
                synopsis: detail?.share_content ?? "",
                contentRating: ContentRating.EVERYONE,
                status: "Completed",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const detail = await this.fetchAlbumDetail(sourceManga.mangaId);
        if (!detail)
            return [];
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter 1",
                volume: 0,
                chapNum: 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const detail = await this.fetchAlbumDetail(chapter.chapterId);
        const pages = (detail?.comic_content ?? [])
            .map((raw) => this.absoluteUrl(raw))
            .filter((url) => url.length > 0);
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
    // API helpers
    // ----------------------------------------------------------------
    async fetchAlbumList(sort, page) {
        const body = this.formBody({
            type: String(TYPE_COMIC),
            sort: String(sort),
            page: String(page),
            page_size: String(PAGE_SIZE),
            lang: "en",
            token: "",
        });
        const parsed = await this.fetchJson(`${API_URL}/lore/album/list`, body);
        return (parsed.data ?? []).filter((entry) => entry.type === TYPE_COMIC);
    }
    async fetchAlbumDetail(id) {
        const body = this.formBody({
            id: this.safeDecode(id),
            lang: "en",
            token: "",
        });
        const parsed = await this.fetchJson(`${API_URL}/lore/album/detail`, body);
        return parsed.data ?? null;
    }
    formBody(params) {
        return Object.entries(params)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&");
    }
    async fetchJson(url, body) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                accept: "application/json, text/plain, */*",
            },
            body,
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
    // ----------------------------------------------------------------
    // URL / id helpers
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/`;
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
}
export const MLBBLore = new MLBBLoreExtension();
