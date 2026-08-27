import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://mehgazone.com";
const AUTHOR = "Patricia Barton";
const THUMBNAIL_REGEX = /\/[^/]+-([0-9]+\.png)$/i;
class MehgazoneInterceptor extends PaperbackInterceptor {
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
export class MehgazoneExtension {
    requestManager = new MehgazoneInterceptor("main");
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
                id: "comics",
                title: "Comics",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const series = await this.fetchSeriesList();
        const items = series.map((entry) => ({
            type: "simpleCarouselItem",
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const series = await this.fetchSeriesList();
        const items = series
            .filter((entry) => titleQuery === "" || entry.title.toLowerCase().includes(titleQuery))
            .map((entry) => ({
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // Parse the homepage sidebar for the "Latest" series listings.
    async fetchSeriesList() {
        const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
        const results = [];
        const seen = new Set();
        const sidebar = $("#main aside.primary-sidebar .sidebar-group").first();
        sidebar.find("h2").each((_, element) => {
            const heading = $(element);
            const headingText = heading.text();
            if (!/latest/i.test(headingText))
                return;
            const parts = headingText.split('"');
            if (parts.length < 2)
                return;
            const title = this.unescapeText(parts[1]);
            if (!title)
                return;
            // Search the following siblings for the feed link and image.
            const siblings = heading.nextAll();
            const feedLink = siblings.find("a[href*='/feed']").first();
            const href = feedLink.attr("href") || "";
            if (!href)
                return;
            const mangaUrl = this.resolveToRoot(href);
            if (!mangaUrl)
                return;
            const mangaId = this.toSafeId(mangaUrl);
            if (seen.has(mangaId))
                return;
            seen.add(mangaId);
            const img = siblings.find("img").first();
            const imageUrl = this.imageFromElement(img);
            results.push({ mangaId, imageUrl, title });
        });
        return results;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = this.unescapeText($("head > title").first().text().trim()) ||
            this.safeDecode(mangaId);
        let thumbnailUrl = "";
        $("#content img[src*='.png']").each((_, element) => {
            if (thumbnailUrl)
                return;
            const src = $(element).attr("src") || "";
            if (THUMBNAIL_REGEX.test(src)) {
                thumbnailUrl = this.absoluteUrl(src.replace(THUMBNAIL_REGEX, "/$1"));
            }
        });
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: "",
                contentRating: ContentRating.MATURE,
                status: "Ongoing",
                tagGroups: [],
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const mangaUrl = this.mangaUrl(sourceManga.mangaId).replace(/\/+$/, "");
        const entries = [];
        let page = 1;
        let totalPages = -1;
        do {
            const url = `${mangaUrl}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,date_gmt,excerpt`;
            const [response, data] = await Application.scheduleRequest({
                url,
                method: "GET",
            });
            if (response.status >= 400)
                break;
            const json = JSON.parse(Application.arrayBufferToUTF8String(data));
            if (!Array.isArray(json))
                break;
            for (const raw of json) {
                const parsed = this.parseChapterListEntry(raw);
                if (parsed)
                    entries.push(parsed);
            }
            const totalHeader = response.headers?.["x-wp-totalpages"];
            if (totalPages === -1) {
                totalPages = totalHeader ? parseInt(totalHeader, 10) : -1;
            }
            if (totalPages > 0) {
                if (page >= totalPages)
                    break;
            }
            else if (json.length < 100) {
                break;
            }
            page++;
        } while (page < 1000);
        // Filter Patreon-locked, dedupe, sort by date ascending, number, reverse.
        const seen = new Set();
        const filtered = entries
            .filter((e) => !e.excerpt.includes("Unlock with Patreon"))
            .filter((e) => {
            if (seen.has(e.id))
                return false;
            seen.add(e.id);
            return true;
        })
            .sort((a, b) => this.parseDate(a.date).getTime() - this.parseDate(b.date).getTime());
        const chapters = filtered.map((entry, index) => {
            const name = this.unescapeText(entry.title).trim() || entry.date.split("T")[0];
            return {
                chapterId: this.toSafeId(`${mangaUrl}/?p=${entry.id}`),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: index,
                publishDate: this.parseDate(entry.date),
                langCode: "🇬🇧",
            };
        });
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const chapterUrl = this.chapterUrl(chapter.chapterId);
        const postId = this.extractPostId(chapterUrl);
        const root = chapterUrl.split("/?")[0].replace(/\/+$/, "");
        const url = `${root}/wp-json/wp/v2/posts?per_page=1&_fields=link,content,excerpt,date,title&include=${postId}`;
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        const pages = [];
        if (response.status < 400) {
            const json = JSON.parse(Application.arrayBufferToUTF8String(data));
            const entry = Array.isArray(json) && json.length > 0
                ? this.parsePageListEntry(json[0])
                : undefined;
            if (entry) {
                const dom = htmlparser2.parseDocument(entry.content);
                const $ = cheerio.load(dom);
                $("img").each((_, element) => {
                    const src = $(element).attr("src") || "";
                    if (src)
                        pages.push(this.absoluteUrl(src));
                });
            }
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
    parseChapterListEntry(raw) {
        if (typeof raw !== "object" || raw === null)
            return undefined;
        const obj = raw;
        const id = typeof obj.id === "number" ? obj.id : undefined;
        if (id === undefined)
            return undefined;
        const date = typeof obj.date_gmt === "string" ? obj.date_gmt : "";
        const title = this.renderedString(obj.title);
        const excerpt = this.renderedString(obj.excerpt);
        return { id, title, date, excerpt };
    }
    parsePageListEntry(raw) {
        if (typeof raw !== "object" || raw === null)
            return undefined;
        const obj = raw;
        const link = typeof obj.link === "string" ? obj.link : "";
        const content = this.renderedString(obj.content);
        const excerpt = this.renderedString(obj.excerpt);
        return { link, content, excerpt };
    }
    renderedString(value) {
        if (typeof value !== "object" || value === null)
            return "";
        const rendered = value.rendered;
        return typeof rendered === "string" ? rendered : "";
    }
    extractPostId(url) {
        const m = url.match(/[?&]p=(\d+)/);
        return m ? m[1] : "";
    }
    resolveToRoot(href) {
        const s = (href || "").trim();
        if (!s)
            return "";
        try {
            const u = new URL(s, BASE_URL);
            return `${u.protocol}//${u.host}/`;
        }
        catch {
            return "";
        }
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
    parseDate(date) {
        if (!date)
            return new Date(0);
        const normalized = date.endsWith("Z") ? date : `${date}Z`;
        const time = Date.parse(normalized);
        return isNaN(time) ? new Date(0) : new Date(time);
    }
    unescapeText(text) {
        if (!text)
            return "";
        const dom = htmlparser2.parseDocument(`<div>${text}</div>`);
        return cheerio.load(dom)("div").first().text();
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
export const Mehgazone = new MehgazoneExtension();
