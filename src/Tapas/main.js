import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://tapas.io";
const API_URL = "https://story-api.tapas.io";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0";
class TapasInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: "https://m.tapas.io",
            origin: BASE_URL,
            "user-agent": USER_AGENT,
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
export class TapasExtension {
    requestManager = new TapasInterceptor("main");
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
                title: "Popular Comics",
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
        const url = section.id === "popular"
            ? `${API_URL}/cosmos/api/v1/landing/ranking?category_type=COMIC&subtab_id=17&size=25&page=${page - 1}`
            : `${API_URL}/cosmos/api/v1/landing/genre?category_type=COMIC&sort_option=NEWEST_EPISODE&subtab_id=17&pageSize=25&page=${page - 1}`;
        const json = await this.fetchJson({ url, method: "GET" });
        const items = [];
        for (const m of json.data?.items ?? []) {
            const parsed = this.mangaFromDto(m);
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
        const hasNext = !(json.meta?.pagination?.last ?? true);
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const url = `${BASE_URL}/search?pageNumber=${page}&q=${encodeURIComponent(titleQuery)}&t=COMICS`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $(".search-item-wrap").each((_, element) => {
            const el = $(element);
            const link = el
                .find(".item__thumb a, .title-section .title a")
                .first();
            const seriesId = link.attr("data-series-id") || "";
            if (!seriesId)
                return;
            const mangaId = this.parsePath(`/series/${seriesId}`);
            if (seen.has(mangaId))
                return;
            seen.add(mangaId);
            const img = el.find(".item__thumb img, .thumb-wrap img").first();
            const title = img.attr("alt") ||
                el.find(".title-section .title a").first().text().trim();
            const imageUrl = this.absoluteUrl(img.attr("src") || "");
            results.push({
                mangaId,
                imageUrl,
                title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a[class*=paging__button--next]").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $(".info__right .title").first().text().trim();
        const thumbnailUrl = this.absoluteUrl($(".thumb.js-thumbnail img").first().attr("src") || "");
        const descParts = [];
        const body = $(".description__body").first().text().trim();
        if (body)
            descParts.push(body);
        const colophon = $(".colophon").first().text().trim();
        if (colophon)
            descParts.push(colophon);
        const synopsis = descParts.join("\n\n");
        const genres = $(".genre-btn")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const uniqueGenres = Array.from(new Set(genres));
        const authors = $(".creator-section .name")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0);
        const author = authors.join(", ");
        const scheduleLabel = $(".schedule-ico:has(.sp-ico-updated-line-pwt) + .schedule-label")
            .first()
            .text();
        const tagGroups = [];
        if (uniqueGenres.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: uniqueGenres.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title || this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl,
                author: author || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(scheduleLabel),
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const seriesPath = this.safeDecode(sourceManga.mangaId).replace(/^\/+/, "");
        const chapters = [];
        const seen = new Set();
        let page = 1;
        let hasNext = true;
        while (hasNext) {
            const since = Date.now();
            const url = `${BASE_URL}/${seriesPath}/episodes?page=${page}&sort=NEWEST&since=${since}&large=true&last_access=0&=`;
            const json = await this.fetchJson({
                url,
                method: "GET",
            });
            const episodes = json.data?.episodes ?? [];
            for (const ep of episodes) {
                // mirror upstream visibility: show paywalled + scheduled by default
                const chapterId = this.parsePath(`/episode/${ep.id}`);
                if (seen.has(chapterId))
                    continue;
                seen.add(chapterId);
                const locked = !(ep.unlocked || ep.free);
                const title = locked ? `🔒 ${ep.title}` : ep.title;
                chapters.push({
                    chapterId,
                    sourceManga,
                    title,
                    volume: 0,
                    chapNum: ep.scene ?? 0,
                    publishDate: this.parseDate(ep.publish_date),
                    langCode: "🇬🇧",
                });
            }
            hasNext = (json.data?.pagination?.has_next ?? false) && episodes.length > 0;
            page++;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("img.content__img").each((_, element) => {
            const el = $(element);
            const src = el.attr("data-src") || el.attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
        });
        // Locked (paywalled/scheduled) chapters have no content images.
        // Mirror upstream keiyoushi: throw a graceful error instead of
        // returning an empty page list (which crashes the reader).
        if (pages.length === 0) {
            throw new Error("Chapter locked");
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
    mangaFromDto(m) {
        const mangaId = this.parsePath(`/series/${m.seriesId}`);
        const cover = m.assetProperty?.bookCoverImage;
        const firstCover = cover ? Object.values(cover)[0] : undefined;
        const imageUrl = firstCover ? this.absoluteUrl(`${firstCover}.png`) : "";
        return { mangaId, imageUrl, title: m.title };
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}/info`;
    }
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parsePath(href) {
        const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
    parseStatus(label) {
        const s = (label || "").toLowerCase();
        if (s.includes("updates"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        return "Unknown";
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
export const Tapas = new TapasExtension();
