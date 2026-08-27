import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://hentairead.io";
const GENRES = [
    { id: "adult", title: "Adult" },
    { id: "action", title: "Action" },
    { id: "adaptation", title: "Adaptation" },
    { id: "adventure", title: "Adventure" },
    { id: "anime", title: "Anime" },
    { id: "comedy", title: "Comedy" },
    { id: "completed", title: "Completed" },
    { id: "cooking", title: "Cooking" },
    { id: "crime", title: "Crime" },
    { id: "crossdressin", title: "Crossdressing" },
    { id: "delinquents", title: "Delinquents" },
    { id: "demons", title: "Demons" },
    { id: "detective", title: "Detective" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "game", title: "Game" },
    { id: "ghosts", title: "Ghosts" },
    { id: "hentai", title: "Hentai" },
    { id: "harem", title: "Harem" },
    { id: "historical", title: "Historical" },
    { id: "horror", title: "Horror" },
    { id: "isekai", title: "Isekai" },
    { id: "josei", title: "Josei" },
    { id: "magic", title: "Magic" },
    { id: "magical", title: "Magical" },
    { id: "manhua", title: "Manhua" },
    { id: "manhwa", title: "Manhwa" },
    { id: "martial-arts", title: "Martial Arts" },
    { id: "mature", title: "Mature" },
    { id: "mecha", title: "Mecha" },
    { id: "medical", title: "Medical" },
    { id: "military", title: "Military" },
    { id: "moder", title: "Moder" },
    { id: "monsters", title: "Monsters" },
    { id: "music", title: "Music" },
    { id: "mystery", title: "Mystery" },
    { id: "office-workers", title: "Office Workers" },
    { id: "one-shot", title: "One shot" },
    { id: "philosophical", title: "Philosophical" },
    { id: "police", title: "Police" },
    { id: "reincarnation", title: "Reincarnation" },
    { id: "reverse", title: "Reverse" },
    { id: "reverse-harem", title: "Reverse harem" },
    { id: "romance", title: "Romance" },
    { id: "royal-family", title: "Royal family" },
    { id: "smut", title: "Smut" },
    { id: "school-life", title: "School Life" },
    { id: "scifi", title: "Sci-fi" },
    { id: "seinen", title: "Seinen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shoujo-ai", title: "Shoujo Ai" },
    { id: "shounen", title: "Shounen" },
    { id: "shounen-ai", title: "Shounen Ai" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "sports", title: "Sports" },
    { id: "super-power", title: "Super power" },
    { id: "superhero", title: "Superhero" },
    { id: "supernatural", title: "Supernatural" },
    { id: "survival", title: "Survival" },
    { id: "thriller", title: "Thriller" },
    { id: "time-travel", title: "Time Travel" },
    { id: "tragedy", title: "Tragedy" },
    { id: "vampire", title: "Vampire" },
    { id: "villainess", title: "Villainess" },
    { id: "webtoons", title: "Webtoons" },
    { id: "yaoi", title: "Yaoi" },
    { id: "yuri", title: "Yuri" },
    { id: "zombies", title: "Zombies" },
];
class HentaiReadIoInterceptor extends PaperbackInterceptor {
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
export class HentaiReadIoExtension {
    requestManager = new HentaiReadIoInterceptor("main");
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
                id: "top-manga",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "lastest-chap",
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
                    metadata: { genre: g.id },
                },
                name: g.title,
                metadata: { genre: g.id },
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const url = `${BASE_URL}/?act=search&f[status]=all&f[sortby]=${section.id}&pageNum=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("div.card:has(.jtip)").each((_, element) => {
            const el = $(element);
            const parsed = this.itemFromElement($, el);
            if (!parsed || seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "top-manga"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = this.hasNextPage($);
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
        const queryMeta = query.metadata;
        const genre = meta?.genre ?? queryMeta?.genre;
        const params = [];
        params.push("act=search");
        params.push(`pageNum=${page}`);
        if (titleQuery) {
            params.push(`f[keyword]=${encodeURIComponent(titleQuery)}`);
        }
        params.push("f[status]=all");
        params.push("f[sortby]=lastest-chap");
        if (genre) {
            params.push(`f[genres]=${encodeURIComponent(genre)}`);
        }
        const url = `${BASE_URL}/?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $("div.card:has(.jtip)").each((_, element) => {
            const el = $(element);
            const parsed = this.itemFromElement($, el);
            if (!parsed)
                return;
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = this.hasNextPage($);
        const nextMeta = { page: page + 1 };
        if (genre)
            nextMeta.genre = genre;
        return {
            items: results,
            metadata: hasNextPage ? nextMeta : undefined,
        };
    }
    hasNextPage($) {
        let found = false;
        $("ul.pagination li.page-item a.page-link").each((_, el) => {
            if ($(el).text().includes("»"))
                found = true;
        });
        return found;
    }
    itemFromElement($, el) {
        const anchor = el.find(".title-manga a").first();
        const href = anchor.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = anchor.text().trim();
        const imageUrl = this.imageFromElement(el.find("img.card-img-top").first());
        if (!title)
            return undefined;
        return { mangaId, imageUrl, title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("h1.title-detail").first().text().trim() || this.safeDecode(mangaId);
        let author = $(".author p.col-8").first().text().trim();
        if (author.toLowerCase().includes("updating"))
            author = "";
        const statusText = $(".status p.col-8").first().text().trim();
        const synopsis = $("#summary_shortened").first().text().trim();
        const thumbnailUrl = this.imageFromElement($(".col-image img").first());
        const genres = $(".kind p.col-8 a")
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
                artist: author || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(statusText),
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        const elements = $("ul#list_chapter_id_detail li.wp-manga-chapter, ul.version-chap li.wp-manga-chapter").toArray();
        elements.forEach((element, index) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = link.text().trim();
            const dateText = el.find(".chapter-release-date i").first().text().trim();
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name) || elements.length - index,
                publishDate: this.parseDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $(".page-chapter img").each((_, element) => {
            const el = $(element);
            const src = el.attr("data-src") || el.attr("src") || "";
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
    parseChapterNumber(name) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    parseDate(text) {
        const t = (text || "").trim();
        if (!t)
            return new Date(0);
        const parsed = Date.parse(t);
        if (!isNaN(parsed))
            return new Date(parsed);
        return new Date(0);
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
    parseStatus(status) {
        const s = (status || "").trim().toLowerCase();
        if (s === "complete" || s === "completed")
            return "Completed";
        if (s === "in process" || s === "ongoing")
            return "Ongoing";
        if (s === "pause" || s === "on hiatus")
            return "Hiatus";
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
export const HentaiReadIo = new HentaiReadIoExtension();
