import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://comicland.org";
const API_URL = "https://api.comicland.org/api";
const PAGE_LIMIT = 20;
class ComicLandInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
export class ComicLandExtension {
    requestManager = new ComicLandInterceptor("main");
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
                id: "official",
                title: "Official",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const offset = (page - 1) * PAGE_LIMIT;
        let url;
        switch (section.id) {
            case "popular":
                url = `${API_URL}/comics/popular?offset=${offset}&limit=${PAGE_LIMIT}`;
                break;
            case "official":
                url = `${API_URL}/comics/official?offset=${offset}&limit=${PAGE_LIMIT}`;
                break;
            case "latest":
            default:
                url = `${API_URL}/comics?offset=${offset}&limit=${PAGE_LIMIT}&status=ongoing`;
                break;
        }
        const parsed = await this.fetchPage(url);
        const items = parsed.comics.map((comic) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: this.toSafeId(comic.slug ?? ""),
            imageUrl: this.absoluteUrl(comic.cover_url ?? ""),
            title: comic.title ?? "",
            metadata: undefined,
        }));
        return {
            items,
            metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const offset = (page - 1) * PAGE_LIMIT;
        const titleQuery = (query.title || "").trim();
        let url;
        if (titleQuery !== "") {
            url = `${API_URL}/comic/search?q=${encodeURIComponent(titleQuery)}&offset=${offset}&limit=${PAGE_LIMIT}`;
        }
        else {
            url = `${API_URL}/comics?offset=${offset}&limit=${PAGE_LIMIT}`;
        }
        const parsed = await this.fetchPage(url);
        const items = parsed.comics.map((comic) => ({
            mangaId: this.toSafeId(comic.slug ?? ""),
            imageUrl: this.absoluteUrl(comic.cover_url ?? ""),
            title: comic.title ?? "",
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items,
            metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const url = `${API_URL}/comic/detail?slug=${encodeURIComponent(slug)}`;
        const data = await this.fetchJson(url);
        const detail = data.data;
        if (!detail) {
            throw new Error("Failed to parse manga details");
        }
        const author = (detail.authors ?? [])
            .map((a) => a.name ?? "")
            .filter((n) => n.length > 0)
            .join(", ");
        const artist = (detail.artists ?? [])
            .map((a) => a.name ?? "")
            .filter((n) => n.length > 0)
            .join(", ");
        const genres = (detail.genres ?? [])
            .map((g) => g.name ?? "")
            .filter((n) => n.length > 0);
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
                primaryTitle: detail.title ?? slug,
                secondaryTitles: [],
                thumbnailUrl: this.absoluteUrl(detail.cover_url ?? ""),
                author: author || undefined,
                artist: artist || undefined,
                synopsis: detail.description ?? "",
                contentRating: ContentRating.MATURE,
                status: "Unknown",
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
        const url = `${API_URL}/comic/detail?slug=${encodeURIComponent(slug)}`;
        const data = await this.fetchJson(url);
        const detail = data.data;
        if (!detail) {
            throw new Error("Failed to parse chapters");
        }
        const detailSlug = detail.slug ?? slug;
        const rawChapters = detail.chapters ?? [];
        const chapters = rawChapters.map((ch) => {
            const indexNum = ch.chapter_index ?? 0;
            const indexStr = indexNum.toString();
            const chapterPath = `/comic/${detailSlug}/chapter/${indexStr}`;
            return {
                chapterId: this.toSafeId(chapterPath.replace(/^\/+/, "")),
                sourceManga,
                title: ch.title ?? `Chapter ${indexStr}`,
                volume: 0,
                chapNum: indexNum,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            };
        });
        // Upstream reverses the API list so newest is first.
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const path = this.safeDecode(chapter.chapterId);
        const slug = path.substring(path.indexOf("/comic/") >= 0
            ? path.indexOf("/comic/") + "/comic/".length
            : "comic/".length);
        const detailSlug = slug.substring(0, slug.indexOf("/chapter/"));
        const index = slug.substring(slug.indexOf("/chapter/") + "/chapter/".length);
        const url = `${API_URL}/chapter/pages_by_index?slug=${encodeURIComponent(detailSlug)}&index=${encodeURIComponent(index)}`;
        const data = await this.fetchJson(url);
        const rawPages = data.data?.pages ?? [];
        const pages = rawPages
            .map((p) => this.absoluteUrl(p))
            .filter((p) => p.length > 0);
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
    async fetchPage(url) {
        const data = await this.fetchJson(url);
        const pageData = data.data;
        if (!pageData) {
            return { comics: [], hasNextPage: false };
        }
        const comics = pageData.list ?? pageData.items ?? [];
        const hasNextPage = pageData.has_more ?? comics.length === PAGE_LIMIT;
        return { comics, hasNextPage };
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/comic/${slug.replace(/^\/+/, "")}`;
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
        const jsonStr = Application.arrayBufferToUTF8String(data);
        return JSON.parse(jsonStr);
    }
    async fetchCheerio(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
}
export const ComicLand = new ComicLandExtension();
