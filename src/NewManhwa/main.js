import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { NewManhwaSearchForm } from "./forms";
const BASE_URL = "https://newmanhwa.com";
class NewManhwaInterceptor extends PaperbackInterceptor {
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
export class NewManhwaExtension {
    requestManager = new NewManhwaInterceptor("main");
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
        return new NewManhwaSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const path = section.id === "latest" ? "latest" : "popular";
        const { items: listItems, hasNextPage } = await this.fetchList(`${BASE_URL}/${path}?page=${page}`);
        const itemType = section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem";
        const items = listItems.map((it) => ({
            type: itemType,
            mangaId: it.mangaId,
            imageUrl: it.imageUrl,
            title: it.title,
            metadata: undefined,
        }));
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
        const params = [`q=${encodeURIComponent(titleQuery)}`];
        const status = searchMeta?.status?.[0];
        if (status)
            params.push(`status=${encodeURIComponent(status)}`);
        const genre = searchMeta?.genre?.[0];
        if (genre)
            params.push(`genre=${encodeURIComponent(genre)}`);
        const sort = searchMeta?.sort?.[0];
        if (sort)
            params.push(`sort=${encodeURIComponent(sort)}`);
        if (page > 1)
            params.push(`page=${page}`);
        const url = `${BASE_URL}/search?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        // Detail-page redirect case.
        if ($("aside.series-left").length > 0) {
            const title = $("h1").first().text().trim();
            const imageUrl = this.absoluteUrl($("aside.series-left .cover-card img").first().attr("src") || "");
            return {
                items: [
                    {
                        mangaId: this.parsePath(url),
                        imageUrl,
                        title,
                        subtitle: undefined,
                        metadata: undefined,
                    },
                ],
                metadata: undefined,
            };
        }
        const { items: listItems, hasNextPage } = this.parseList($);
        const items = listItems.map((it) => ({
            mangaId: it.mangaId,
            imageUrl: it.imageUrl,
            title: it.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    async fetchList(url) {
        const $ = await this.fetchCheerio({ url, method: "GET" });
        return this.parseList($);
    }
    parseList($) {
        const items = [];
        $("a.series-card").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            const title = this.removeTitleRank(el.find("strong").first().text().trim());
            if (!href || !title)
                return;
            const img = el.find("img").first();
            const imageUrl = this.absoluteUrl(img.attr("data-src") || img.attr("src") || "");
            items.push({ mangaId: this.parsePath(href), title, imageUrl });
        });
        const hasNextPage = $("a:contains(Next):not(.disabled)").length > 0;
        return { items, hasNextPage };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("h1").first().text().trim() || this.safeDecode(mangaId);
        const synopsis = $("section.summary-inline p").first().text().trim();
        const author = $("dt:contains(Author) + dd a span").first().text().trim();
        const artist = $("dt:contains(Artist) + dd a span").first().text().trim();
        const statusText = $("dt:contains(Status) + dd span").first().text().trim();
        const thumbnailUrl = this.absoluteUrl($("aside.series-left .cover-card img").first().attr("src") || "");
        const tagGroups = [];
        const jsonLd = $("script[type='application/ld+json']")
            .toArray()
            .map((el) => $(el).text())
            .find((d) => d.includes('"@type":"ComicSeries"'));
        if (jsonLd) {
            const m = jsonLd.match(/"genre":\s*\[(.*?)\]/);
            if (m) {
                const genres = m[1]
                    .replace(/"/g, "")
                    .split(",")
                    .map((g) => g.trim())
                    .filter((g) => g.length > 0);
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
            }
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
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        $(".chapter-list .chapter-row").each((_, element) => {
            const el = $(element);
            const link = el.find("a.chapter-main").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const name = link.find(".chapter-name strong").first().text().trim();
            const dateText = el.find(".chapter-age").first().text().trim();
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(name),
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
        $("main#reader img.chapter-page").each((_, element) => {
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
    removeTitleRank(title) {
        return title.replace(/^#\d+\s+/, "").trim();
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
    parseChapterNumber(name) {
        const match = name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : -1;
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
}
export const NewManhwa = new NewManhwaExtension();
