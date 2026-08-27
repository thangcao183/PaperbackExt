import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { MangaKatanaSearchForm } from "./forms";
const BASE_URL = "https://mangakatana.com";
class MangaKatanaInterceptor extends PaperbackInterceptor {
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
export class MangaKatanaExtension {
    requestManager = new MangaKatanaInterceptor("main");
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
        return new MangaKatanaSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        let url;
        let itemType;
        if (section.id === "popular") {
            // Popular is actually the alphabetical manga listing.
            url = `${BASE_URL}/manga/page/${page}`;
            itemType = "featuredCarouselItem";
        }
        else {
            url = `${BASE_URL}/page/${page}`;
            itemType = "simpleCarouselItem";
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        $("div#book_list > div.item").each((_, element) => {
            const el = $(element);
            const parsed = this.parseListItem($, el);
            if (!parsed)
                return;
            items.push({
                type: itemType,
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a.next.page-numbers").length > 0;
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
        const searchMeta = query.metadata?.searchMeta;
        const url = this.buildSearchUrl(titleQuery, searchMeta, page);
        // MangaKatana returns HTTP 404 for searches that match nothing
        // (e.g. single-character queries while the user is still typing).
        // Treat that as an empty result set rather than surfacing an error.
        let $;
        try {
            $ = await this.fetchCheerio({ url, method: "GET" });
        }
        catch {
            return { items: [], metadata: undefined };
        }
        // A text search may redirect straight to a single manga detail page.
        if ($("div#book_list").length === 0 && $("h1.heading").length > 0) {
            const title = $("h1.heading").first().text().trim();
            const imageUrl = this.absoluteUrl($("div.media div.cover img").first().attr("src") || "");
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
        const results = [];
        $("div#book_list > div.item").each((_, element) => {
            const el = $(element);
            const parsed = this.parseListItem($, el);
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
        const hasNextPage = $("a.next.page-numbers").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    buildSearchUrl(query, searchMeta, page) {
        if (query) {
            const searchBy = searchMeta?.searchBy?.[0] || "book_name";
            return `${BASE_URL}/page/${page}?search=${encodeURIComponent(query)}&search_by=${searchBy}`;
        }
        const params = ["filter=1"];
        const include = searchMeta?.includeGenres ?? [];
        const exclude = searchMeta?.excludeGenres ?? [];
        if (include.length > 0) {
            params.push(`include=${include.join("_")}`);
        }
        if (exclude.length > 0) {
            params.push(`exclude=${exclude.join("_")}`);
        }
        const includeMode = searchMeta?.includeMode?.[0];
        if (includeMode) {
            params.push(`include_mode=${includeMode}`);
        }
        const order = searchMeta?.order?.[0];
        if (order) {
            params.push(`order=${order}`);
        }
        const status = searchMeta?.status?.[0];
        if (status) {
            params.push(`status=${status}`);
        }
        const minChapters = (searchMeta?.minChapters ?? "").trim();
        if (minChapters === "-1") {
            params.push("chapters=e1");
        }
        else if (minChapters === "") {
            params.push("chapters=1");
        }
        else {
            params.push(`chapters=${encodeURIComponent(minChapters)}`);
        }
        return `${BASE_URL}/manga/page/${page}?${params.join("&")}`;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const thumbnailUrl = this.absoluteUrl($("div.media div.cover img").first().attr("src") || "");
        const title = $("h1.heading").first().text().trim() || this.safeDecode(mangaId);
        const authors = $(".author")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0);
        const author = authors.join(", ");
        const summary = $(".summary > p").first().text().trim();
        const altName = $(".alt_name").first().text().trim();
        const synopsis = altName
            ? `${summary}\n\nAlt name(s): ${altName}`
            : summary;
        const statusText = $(".value.status").first().text().trim();
        const genres = $(".genres > a")
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
                secondaryTitles: altName ? [altName] : [],
                thumbnailUrl,
                author: author || undefined,
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
        $("tr:has(.chapter)").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const name = link.text().trim();
            const dateText = el.find(".update_time").first().text().trim();
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
        const script = $("script")
            .map((_, el) => $(el).html() || "")
            .get()
            .find((data) => data.includes("data-src"));
        if (script) {
            const arrNameMatch = script.match(/data-src['"],\s*(\w+)/);
            if (arrNameMatch) {
                const arrName = arrNameMatch[1];
                const arrBodyMatch = script.match(new RegExp("var " + arrName + "=\\[([^\\[]*)]"));
                if (arrBodyMatch) {
                    const urlMatches = arrBodyMatch[1].matchAll(/'([^']*)'/g);
                    for (const m of urlMatches) {
                        const u = m[1];
                        if (u)
                            pages.push(u);
                    }
                }
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
    parseListItem($, el) {
        const link = el.find("div.text > h3 > a").first();
        const href = link.attr("href") || "";
        // ownText: take the link's direct text only.
        const title = link.text().trim();
        if (!href || !title)
            return undefined;
        const imageUrl = this.absoluteUrl(el.find("img").first().attr("src") || "");
        return { mangaId: this.parsePath(href), title, imageUrl };
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
        const match = name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : -1;
    }
    absoluteUrl(src) {
        const s = (src || "").trim();
        if (!s)
            return "";
        if (s.startsWith("http"))
            return s;
        return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
    }
    parseStatus(status) {
        const s = status || "";
        if (s.includes("Ongoing"))
            return "Ongoing";
        if (s.includes("Completed"))
            return "Completed";
        return "Unknown";
    }
    parseDate(dateText) {
        if (!dateText)
            return new Date(0);
        // Format MMM-dd-yyyy (e.g. Jan-05-2024)
        const normalized = dateText.replace(/-/g, " ");
        const d = new Date(normalized);
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
export const MangaKatana = new MangaKatanaExtension();
