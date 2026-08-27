import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://readbagabondo.com";
const IMAGE_BASE_URL = "https://pub.moleve.net";
class ReadVagabondMangaInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json,text/plain,*/*",
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
export class ReadVagabondMangaExtension {
    requestManager = new ReadVagabondMangaInterceptor("main");
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
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const mangas = await this.fetchJson(`${BASE_URL}/api/mihon/mangas`);
        const items = [];
        for (const manga of mangas) {
            items.push({
                type: "featuredCarouselItem",
                mangaId: String(manga.id),
                imageUrl: this.absoluteUrl(manga.cover),
                title: manga.title,
                metadata: undefined,
            });
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const params = [
            `q=${encodeURIComponent(titleQuery)}`,
            `page=${page}`,
        ];
        const url = `${BASE_URL}/api/mihon/mangas?${params.join("&")}`;
        const mangas = await this.fetchJson(url);
        const results = [];
        for (const manga of mangas) {
            results.push({
                mangaId: String(manga.id),
                imageUrl: this.absoluteUrl(manga.cover),
                title: manga.title,
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
        const manga = await this.fetchJson(`${BASE_URL}/api/mihon/mangas/${encodeURIComponent(mangaId)}`);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: manga.title,
                secondaryTitles: [],
                thumbnailUrl: this.absoluteUrl(manga.cover),
                author: manga.author,
                artist: manga.artist,
                synopsis: manga.description,
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(manga.status),
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const chapters = await this.fetchJson(`${BASE_URL}/api/mihon/mangas/${encodeURIComponent(mangaId)}/chapters`);
        return chapters.map((chapter) => ({
            chapterId: `${mangaId}/${chapter.number}`,
            sourceManga,
            title: chapter.title,
            volume: chapter.volume ?? 0,
            chapNum: chapter.number,
            publishDate: this.parseDate(chapter.releaseDate),
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const { mangaId, chapterNumber } = this.parseChapterId(chapter.chapterId);
        const chapterDto = await this.fetchJson(`${BASE_URL}/api/mihon/mangas/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterNumber)}`);
        const pages = [];
        for (let page = 1; page <= chapterDto.pageCount; page++) {
            pages.push(`${IMAGE_BASE_URL}/chapter-${chapterDto.number}/page-${page}.png`);
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
    mangaUrl(_mangaId) {
        return BASE_URL;
    }
    parseChapterId(chapterId) {
        const idx = chapterId.lastIndexOf("/");
        if (idx === -1) {
            return { mangaId: chapterId, chapterNumber: "0" };
        }
        return {
            mangaId: chapterId.slice(0, idx),
            chapterNumber: chapterId.slice(idx + 1),
        };
    }
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("hiatus"))
            return "Hiatus";
        return "Ongoing";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const t = Date.parse(value);
        return isNaN(t) ? new Date(0) : new Date(t);
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
}
export const ReadVagabondManga = new ReadVagabondMangaExtension();
