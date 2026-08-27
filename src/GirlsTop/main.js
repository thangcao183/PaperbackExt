import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://en.girlstop.info";
// Enforce a desktop User-Agent to prevent redirects to the mobile site (me.girlstop.info)
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const TITLE_SUFFIX_REGEX = / - nude galleries.*/;
const MAX_CHAPTER_PAGES = 50;
class GirlsTopInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": DESKTOP_UA,
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
                    "user-agent": DESKTOP_UA,
                },
            });
        }
        return data;
    }
}
export class GirlsTopExtension {
    requestManager = new GirlsTopInterceptor("main");
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
        const sortPath = section.id === "popular" ? "filter.php?srt=viw" : "index.php";
        const url = this.listUrl(sortPath, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const parsed = this.extractMangas($);
        const items = parsed.mangas.map((m) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
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
        const titleQuery = (query.title || "").trim();
        if (titleQuery !== "") {
            // Text query -> POST to models.php with form body "text=query".
            const $ = await this.fetchCheerio({
                url: `${BASE_URL}/models.php`,
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `text=${encodeURIComponent(titleQuery)}`,
            });
            const parsed = this.extractMangas($);
            const items = parsed.mangas.map((m) => ({
                mangaId: m.mangaId,
                imageUrl: m.imageUrl,
                title: m.title,
                subtitle: undefined,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        // No query -> browse popular listing (paged).
        const url = this.listUrl("filter.php?srt=viw", page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const parsed = this.extractMangas($);
        const items = parsed.mangas.map((m) => ({
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
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
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const decoded = this.safeDecode(mangaId);
        if (decoded.includes("models.php")) {
            const title = $("h1.index")
                .first()
                .text()
                .replace(TITLE_SUFFIX_REGEX, "")
                .trim() || decoded;
            const synopsis = $("#modeldesc").first().text().trim();
            const thumbnailUrl = this.imageFromElement($(".model-cover img").first());
            return {
                mangaId,
                mangaInfo: {
                    primaryTitle: title,
                    secondaryTitles: [],
                    thumbnailUrl,
                    synopsis,
                    contentRating: ContentRating.MATURE,
                    status: "Ongoing",
                    tagGroups: [],
                    shareUrl: url,
                },
            };
        }
        const title = $("h1").first().text().trim() || decoded;
        const author = $(".ps-desc a[href*='user.php']").first().text().trim() || undefined;
        const genres = $(".ps-tags a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const descParts = [];
        $(".ps-desc").each((_, el) => {
            const e = $(el);
            if (e.hasClass("ps-tags"))
                return;
            const t = e.text().trim();
            if (t)
                descParts.push(t);
        });
        const synopsis = descParts.join("\n").trim();
        const thumbnailUrl = this.imageFromElement($(".tiles-wrap img").first());
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
                author,
                artist: author,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: "Completed",
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const decoded = this.safeDecode(sourceManga.mangaId);
        // A single gallery post (psto.php) is treated as one "Gallery" chapter.
        if (decoded.includes("psto.php")) {
            return [
                {
                    chapterId: sourceManga.mangaId,
                    sourceManga,
                    title: "Gallery",
                    volume: 0,
                    chapNum: 1,
                    publishDate: new Date(0),
                    langCode: "🇬🇧",
                },
            ];
        }
        const chapters = [];
        const seen = new Set();
        let nextUrl = this.mangaUrl(sourceManga.mangaId);
        for (let i = 0; i < MAX_CHAPTER_PAGES && nextUrl; i++) {
            const $ = await this.fetchCheerio({
                url: nextUrl,
                method: "GET",
            });
            $(".thumbs .thumb").each((_, element) => {
                const el = $(element);
                const a = el.find(".post_title a").first();
                const href = a.attr("href") || "";
                if (!href)
                    return;
                const chapterId = this.parsePath(href);
                if (!chapterId || seen.has(chapterId))
                    return;
                seen.add(chapterId);
                const name = a.text().trim();
                const publishDate = this.parseApprovedDate($, el);
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: name,
                    volume: 0,
                    chapNum: 0,
                    publishDate,
                    langCode: "🇬🇧",
                });
            });
            const nextHref = $("li.next a").first().attr("href");
            nextUrl = nextHref ? this.absoluteUrl(`/${nextHref.replace(/^\/+/, "")}`) : undefined;
        }
        return chapters.map((chapter, index) => ({
            ...chapter,
            chapNum: chapters.length - index,
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("a.fullimg").each((_, element) => {
            const href = $(element).attr("href") || "";
            if (href)
                pages.push(this.absoluteUrl(href));
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
    extractMangas($) {
        const mangas = [];
        const seen = new Set();
        $(".thumbs .thumb").each((_, element) => {
            const el = $(element);
            const a = el.find(".post_title a").first();
            const href = a.attr("href") || "";
            if (!href)
                return;
            const mangaId = this.parsePath(href);
            if (!mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            const title = a.text().trim();
            const imageUrl = this.imageFromElement(el.find("picture img").first());
            if (!title)
                return;
            mangas.push({ mangaId, imageUrl, title });
        });
        const hasNextPage = $("li.next a").length > 0;
        return { mangas, hasNextPage };
    }
    parseApprovedDate($, el) {
        let dateStr = "";
        el.find("tr").each((_, row) => {
            if (dateStr)
                return;
            const tds = $(row).find("td");
            const label = tds.first().text();
            if (label.includes("Approved")) {
                dateStr = tds.last().text().trim();
            }
        });
        return this.parseDate(dateStr);
    }
    parseDate(dateStr) {
        const s = (dateStr || "").trim();
        if (!s)
            return new Date(0);
        const lower = s.toLowerCase();
        if (lower.includes("today") ||
            lower.includes("just now") ||
            lower.includes("recently")) {
            return new Date();
        }
        if (lower.includes("yesterday")) {
            return new Date(Date.now() - 86400000);
        }
        // Format: "dd MMM yyyy" e.g. "05 Jan 2024"
        const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
        if (m) {
            const day = parseInt(m[1], 10);
            const month = this.monthIndex(m[2]);
            const year = parseInt(m[3], 10);
            if (month >= 0) {
                return new Date(year, month, day);
            }
        }
        const parsed = new Date(s);
        return isNaN(parsed.getTime()) ? new Date(0) : parsed;
    }
    monthIndex(name) {
        const months = [
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
        ];
        return months.indexOf(name.slice(0, 3).toLowerCase());
    }
    listUrl(sortPath, page) {
        if (page <= 1) {
            return `${BASE_URL}/${sortPath}`;
        }
        return `${BASE_URL}/${sortPath}&page=${page - 1}`;
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
        const cleaned = decoded.replace(/#.*$/, "");
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
    imageFromElement(img) {
        const src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            img.attr("data-cfsrc") ||
            img.attr("src") ||
            "";
        return this.absoluteUrl(src);
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
export const GirlsTop = new GirlsTopExtension();
