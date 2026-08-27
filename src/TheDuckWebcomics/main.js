import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { TheDuckWebcomicsSearchForm, } from "./forms";
const BASE_URL = "https://www.theduckwebcomics.com";
class TheDuckWebcomicsInterceptor extends PaperbackInterceptor {
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
export class TheDuckWebcomicsExtension {
    requestManager = new TheDuckWebcomicsInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
        bufferInterval: 1,
        ignoreImages: true,
    });
    // Cache of the most-recently parsed search entries, so getMangaDetails
    // (which the site only exposes via search) can find its data.
    detailsCache = new Map();
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
        const page = metadata?.page ?? 1;
        let url = `${BASE_URL}/search/?page=${page}`;
        if (section.id === "latest") {
            url += "&last_update=today";
        }
        const itemType = section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem";
        const { entries, hasNextPage } = await this.fetchList(url);
        const items = entries.map((e) => ({
            type: itemType,
            mangaId: e.mangaId,
            imageUrl: e.imageUrl,
            title: e.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        const url = this.buildSearchUrl(titleQuery, page, searchMeta);
        const { entries, hasNextPage } = await this.fetchList(url);
        const items = entries.map((e) => ({
            mangaId: e.mangaId,
            imageUrl: e.imageUrl,
            title: e.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    async getAdvancedSearchForm() {
        return new TheDuckWebcomicsSearchForm();
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const entry = this.detailsCache.get(mangaId);
        const tagGroups = [];
        if (entry?.genre) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: [{ id: entry.genre, title: entry.genre }],
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: entry?.title || this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl: entry?.imageUrl || "",
                author: entry?.author || undefined,
                artist: entry?.author || undefined,
                synopsis: entry?.description || "",
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
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const error = $(".yellow-box > .paranomargin").first().text().trim();
        if (error) {
            throw new Error(error);
        }
        const chapters = [];
        const options = $("#page_dropdown > option").toArray();
        options.forEach((element, index) => {
            const el = $(element);
            const value = el.attr("value") || "";
            if (!value)
                return;
            const name = el.text().split("- ").slice(1).join("- ").trim() || el.text().trim();
            chapters.push({
                chapterId: this.parsePath(`${this.safeDecode(sourceManga.mangaId)}/${value}/`),
                sourceManga,
                title: name || `Chapter ${index + 1}`,
                volume: 0,
                chapNum: index + 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const src = $(".page-image").first().attr("src");
        if (src)
            pages.push(this.absoluteUrl(src));
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
    buildSearchUrl(titleQuery, page, searchMeta) {
        const params = [];
        params.push(`search=${encodeURIComponent(titleQuery)}`);
        params.push(`page=${page}`);
        if (searchMeta) {
            for (const t of searchMeta.type ?? [])
                params.push(`type=${encodeURIComponent(t)}`);
            for (const t of searchMeta.tone ?? [])
                params.push(`tone=${encodeURIComponent(t)}`);
            for (const s of searchMeta.style ?? [])
                params.push(`style=${encodeURIComponent(s)}`);
            for (const g of searchMeta.genre ?? [])
                params.push(`genre=${encodeURIComponent(g)}`);
            for (const r of searchMeta.rating ?? [])
                params.push(`rating=${encodeURIComponent(r)}`);
            const lastUpdate = searchMeta.lastUpdate?.[0];
            if (lastUpdate)
                params.push(`last_update=${encodeURIComponent(lastUpdate)}`);
        }
        return `${BASE_URL}/search?${params.join("&")}`;
    }
    async fetchList(url) {
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        $(".breadcrumb ~ div[style]").each((_, element) => {
            const entry = this.parseListItem($, $(element));
            if (entry) {
                entries.push(entry);
                this.detailsCache.set(entry.mangaId, entry);
            }
        });
        const hasNextPage = $("a.next").length > 0;
        return { entries, hasNextPage };
    }
    parseListItem($, element) {
        const titleEl = element.find(".size24").first();
        const title = titleEl.text().trim();
        const href = titleEl.attr("href") || "";
        if (!title || !href)
            return undefined;
        const mangaId = this.parsePath(href);
        const genre = (element.find(".size10").first().text() || "")
            .split(",")[0]
            .trim();
        const description = element.find(".comicdescparagraphs").first().text().trim();
        const imageUrl = this.absoluteUrl(element.find("img").first().attr("src") || "");
        const author = element.find(".size18").first().text().trim();
        return { mangaId, title, imageUrl, author, genre, description };
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
}
export const TheDuckWebcomics = new TheDuckWebcomicsExtension();
