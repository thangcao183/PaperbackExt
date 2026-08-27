import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://clowncorps.net";
const MANGA_ID = "comic";
const TITLE = "Clown Corps";
const CREATOR = "Joe Chouinard";
const THUMBNAIL = `${BASE_URL}/wp-content/uploads/2022/11/clowns41.jpg`;
const DESCRIPTION = 'Clown Corps is a comic about crime-fighting clowns.\n' +
    'It\'s pronounced "core." Like marine corps.';
const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
};
class ClownCorpsInterceptor extends PaperbackInterceptor {
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
export class ClownCorpsExtension {
    requestManager = new ClownCorpsInterceptor("main");
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
                id: "comic",
                title: TITLE,
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = [
            {
                type: "featuredCarouselItem",
                mangaId: MANGA_ID,
                imageUrl: THUMBNAIL,
                title: TITLE,
                metadata: undefined,
            },
        ];
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const items = [];
        if (titleQuery === "" || TITLE.toLowerCase().includes(titleQuery)) {
            items.push({
                mangaId: MANGA_ID,
                imageUrl: THUMBNAIL,
                title: TITLE,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: TITLE,
                secondaryTitles: [],
                thumbnailUrl: THUMBNAIL,
                author: CREATOR,
                artist: CREATOR,
                synopsis: DESCRIPTION,
                contentRating: ContentRating.EVERYONE,
                status: "Ongoing",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const firstUrl = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url: firstUrl, method: "GET" });
        // The total number of webpages with chapters on them.
        const pageIndicator = $("#paginav li.paginav-pages").text().trim();
        let totalPages = 1;
        if (pageIndicator) {
            const parts = pageIndicator.split(" ");
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(last) && last > 0)
                totalPages = last;
        }
        const all = [];
        const seen = new Set();
        const extract = ($page) => {
            let added = false;
            $page(".comic").each((_index, element) => {
                const el = $page(element);
                const link = el.find(".post-title a").first();
                const href = link.attr("href") || "";
                if (!href)
                    return;
                const chapterId = this.parsePath(href);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const name = link.text().trim();
                const postDate = el.find(".post-date").first().text().trim();
                const postTime = el.find(".post-time").first().text().trim();
                const dateUpload = this.parseDate(`${postDate} ${postTime}`);
                all.push({ fullLink: chapterId, name, dateUpload });
                added = true;
            });
            return added;
        };
        extract($);
        for (let pageIndex = 2; pageIndex <= totalPages; pageIndex++) {
            const url = `${BASE_URL}/comic/page/${pageIndex}/`;
            const $page = await this.fetchCheerio({ url, method: "GET" });
            const anyAdded = extract($page);
            if (!anyAdded)
                break;
        }
        all.sort((a, b) => b.dateUpload - a.dateUpload);
        return all.map((chapter, index) => ({
            chapterId: chapter.fullLink,
            sourceManga,
            title: chapter.name,
            volume: 0,
            chapNum: all.length - index,
            publishDate: chapter.dateUpload > 0 ? new Date(chapter.dateUpload) : new Date(0),
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const image = $("#comic img").first();
        const src = image.attr("src") || "";
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
    parseDate(dateStr) {
        // Upstream format: "MMMM dd, yyyy hh:mm aa" e.g. "November 5, 2022 12:00 AM"
        const m = dateStr
            .trim()
            .match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])/);
        if (!m)
            return 0;
        const month = MONTHS[m[1].toLowerCase()];
        if (month === undefined)
            return 0;
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        let hour = parseInt(m[4], 10);
        const minute = parseInt(m[5], 10);
        const meridiem = m[6].toLowerCase();
        if (meridiem === "pm" && hour < 12)
            hour += 12;
        if (meridiem === "am" && hour === 12)
            hour = 0;
        const time = new Date(year, month, day, hour, minute).getTime();
        return isNaN(time) ? 0 : time;
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
        const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
export const ClownCorps = new ClownCorpsExtension();
