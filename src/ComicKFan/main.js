import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { ComicKFanSearchForm } from "./forms";
const BASE_URL = "https://comickfan.com";
class ComicKFanInterceptor extends PaperbackInterceptor {
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
export class ComicKFanExtension {
    requestManager = new ComicKFanInterceptor("main");
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
    async getAdvancedSearchForm(query) {
        const meta = query.metadata;
        return new ComicKFanSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "rating" : "latest";
        const url = this.buildSearchUrl({ sort }, "", page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        this.eachSearchItem($, (item) => {
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: item.mangaId,
                imageUrl: item.imageUrl,
                title: item.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a:has(img[alt=Next])").length > 0;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const url = this.buildSearchUrl({
            sort: searchMeta?.sort?.[0],
            status: searchMeta?.status?.[0],
            type: searchMeta?.type?.[0],
            genres: searchMeta?.genres,
        }, titleQuery, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        this.eachSearchItem($, (item) => {
            results.push({
                mangaId: item.mangaId,
                imageUrl: item.imageUrl,
                title: item.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a:has(img[alt=Next])").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    buildSearchUrl(opts, titleQuery, page) {
        const params = [];
        const genres = opts.genres ?? [];
        params.push(`genres=${encodeURIComponent(genres.join("_"))}`);
        params.push(`status=${encodeURIComponent(opts.status ?? "")}`);
        params.push(`type=${encodeURIComponent(opts.type ?? "")}`);
        params.push(`sort=${encodeURIComponent(opts.sort ?? "")}`);
        params.push(`name=${encodeURIComponent(titleQuery)}`);
        params.push(`page=${page}`);
        return `${BASE_URL}/advanced-search?${params.join("&")}`;
    }
    eachSearchItem($, cb) {
        $("div:has(> form) + div.grid > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const img = el.find("img").first();
            const title = (img.attr("alt") || "").trim();
            if (!title)
                return;
            const imageUrl = this.absoluteUrl(img.attr("src") || "");
            cb({ mangaId: this.parsePath(href), title, imageUrl });
        });
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const infoRoot = $("div[class=bg-card-section]");
        const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
        const synopsis = $("div.comic-content.desk").first().text().trim();
        const author = this.getValue($, infoRoot, "Author");
        const artist = this.getValue($, infoRoot, "Artist");
        const statusText = this.getValue($, infoRoot, "Status");
        const thumbnailUrl = this.absoluteUrl(infoRoot.find("div.thumb-cover img").first().attr("src") || "");
        const genres = infoRoot
            .find("div.font-medium:contains(Genres) + div a")
            .map((_, el) => $(el).text().trim())
            .get()
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
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: author || undefined,
                artist: artist || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(statusText),
                tagGroups,
                shareUrl: url,
            },
        };
    }
    getValue($, infoRoot, label) {
        let value = "";
        infoRoot.find("div.flex-row.gap-4").each((_, element) => {
            if (value)
                return;
            const el = $(element);
            const labelText = el.find("> div.text-sm").first().text().trim();
            if (labelText !== label)
                return;
            const text = el
                .find("> div.text-sm:nth-child(2):last-child")
                .text()
                .trim();
            if (text && text !== "-" && text !== "_")
                value = text;
        });
        return value;
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const comicId = this.comicIdFromMangaId(sourceManga.mangaId);
        const url = `${BASE_URL}/api/comics/${comicId}/chapter-list?translation_group_id=`;
        const response = await this.fetchJson({
            url,
            method: "GET",
        });
        const chapters = [];
        for (const dto of response.data ?? []) {
            const chapterId = this.parsePath(`/manga/${comicId}/chapter-${dto.chapter}-${dto.hash_id}`);
            const chapNum = parseFloat(dto.chapter);
            chapters.push({
                chapterId,
                sourceManga,
                title: `Chapter ${dto.chapter}`,
                volume: 0,
                chapNum: isNaN(chapNum) ? -1 : chapNum,
                publishDate: this.parseDate(dto.published_at ?? dto.created_at),
                langCode: "🇬🇧",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("div.w-full > img[loading=lazy]").each((_, element) => {
            const src = $(element).attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
        });
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
    comicIdFromMangaId(mangaId) {
        // mangaId is /manga/{slug}; comicId is the slug (2nd path segment).
        const decoded = this.safeDecode(mangaId).replace(/^\/+/, "");
        const segments = decoded.split("/");
        return segments[1] ?? segments[segments.length - 1] ?? decoded;
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parsePath(href) {
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
        const slug = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        return this.toSafeId(slug);
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
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("hiatus"))
            return "Hiatus";
        return "Unknown";
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date(0);
        const d = new Date(dateText);
        return isNaN(d.getTime()) ? new Date(0) : d;
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
    async fetchCheerio(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
}
export const ComicKFan = new ComicKFanExtension();
