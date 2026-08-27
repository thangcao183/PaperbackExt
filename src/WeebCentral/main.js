import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { WeebCentralSearchForm } from "./forms";
const BASE_URL = "https://weebcentral.com";
const FETCH_LIMIT = 32;
const EXCLUDED_SEARCH_CHARS = /[!#:(),-]/g;
// Upstream #18165 `seasonRegex`: titles that name a season need positional
// chapter numbering instead of "first number in the string".
const SEASON_REGEX = /(Season|S)\s*\d+/i;
class WeebCentralInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        // Upstream #18165 (`removeAll("Origin")`): sending Origin makes the site
        // serve mismatched thumbnails, so it must never be set.
        delete request.headers["origin"];
        delete request.headers["Origin"];
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
export class WeebCentralExtension {
    requestManager = new WeebCentralInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 1,
        bufferInterval: 2,
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
        return new WeebCentralSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "Popularity" : "Latest Updates";
        const url = this.buildSearchUrl({ sort: [sort], page });
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        $("article > section > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            const mangaId = this.parsePath(href);
            const title = el
                .find("div:not([class]):last-child")
                .first()
                .text()
                .trim();
            const imageUrl = this.sourceImg(el);
            if (mangaId && title && imageUrl) {
                items.push({
                    type: section.id === "popular"
                        ? "featuredCarouselItem"
                        : "simpleCarouselItem",
                    mangaId,
                    imageUrl,
                    title,
                    metadata: undefined,
                });
            }
        });
        const hasNextPage = $("button").length > 0;
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
        const url = this.buildSearchUrl({
            text: titleQuery,
            sort: searchMeta?.sort,
            order: searchMeta?.order,
            adult: searchMeta?.adult,
            status: searchMeta?.status,
            type: searchMeta?.type,
            tags: searchMeta?.tags,
            author: searchMeta?.author,
            page,
        });
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $("article > section > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            const mangaId = this.parsePath(href);
            const title = el
                .find("div:not([class]):last-child")
                .first()
                .text()
                .trim();
            const imageUrl = this.sourceImg(el);
            if (mangaId && title && imageUrl) {
                results.push({
                    mangaId,
                    imageUrl,
                    title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            }
        });
        const hasNextPage = $("button").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    buildSearchUrl(opts) {
        const params = [];
        const text = (opts.text || "").replace(EXCLUDED_SEARCH_CHARS, " ").trim();
        params.push(`text=${encodeURIComponent(text)}`);
        params.push(`sort=${encodeURIComponent(opts.sort?.[0] || "Best Match")}`);
        params.push(`order=${encodeURIComponent(opts.order?.[0] || "Descending")}`);
        params.push("official=Any");
        params.push("anime=Any");
        params.push(`adult=${encodeURIComponent(opts.adult?.[0] || "Any")}`);
        if (opts.author) {
            params.push(`author=${encodeURIComponent(opts.author)}`);
        }
        for (const s of opts.status ?? []) {
            params.push(`included_status=${encodeURIComponent(s)}`);
        }
        for (const t of opts.type ?? []) {
            params.push(`included_type=${encodeURIComponent(t)}`);
        }
        for (const tag of opts.tags ?? []) {
            params.push(`included_tag=${encodeURIComponent(tag)}`);
        }
        const offset = ((opts.page ?? 1) - 1) * FETCH_LIMIT;
        params.push(`limit=${FETCH_LIMIT}`);
        params.push(`offset=${offset}`);
        params.push("display_mode=Full%20Display");
        return `${BASE_URL}/search/data?${params.join("&")}`;
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const sections = $("section[x-data] > section");
        const infoSection = sections.eq(0);
        const titleSection = sections.eq(1);
        const thumbnailUrl = this.sourceImg(infoSection);
        const author = infoSection
            .find("ul > li:has(strong:contains(Author)) > span > a")
            .map((_, el) => $(el).text().trim())
            .get()
            .join(", ");
        const genres = infoSection
            .find("ul > li:has(strong:contains(Tag)) a, ul > li:has(strong:contains(Type)) a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const statusText = infoSection
            .find("ul > li:has(strong:contains(Status)) > a")
            .first()
            .text();
        const title = titleSection.find("h1").first().text().trim() ||
            this.safeDecode(mangaId);
        const descParts = [];
        const desc = titleSection
            .find("li:has(strong:contains(Description)) > p")
            .first()
            .text()
            .trim();
        if (desc)
            descParts.push(desc.replace("NOTE: ", "\n\nNOTE: "));
        const altTitles = titleSection
            .find("li:has(strong:contains(Associated Name)) li")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0);
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
                secondaryTitles: altTitles,
                thumbnailUrl,
                author: author || undefined,
                synopsis: descParts.join(""),
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
        const segments = this.safeDecode(sourceManga.mangaId)
            .split("/")
            .filter((s) => s.length > 0);
        // /series/{id}/{slug} -> /series/{id}/full-chapter-list
        const base = segments.length >= 2
            ? `${segments[0]}/${segments[1]}`
            : segments.join("/");
        const url = `${BASE_URL}/${base}/full-chapter-list`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        // The listing is in descending order (newest first).
        const anchors = $("div[x-data] > a");
        const total = anchors.length;
        anchors.each((index, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = el.find("span.flex > span").first().text().trim();
            const dateText = el.find("time[datetime]").first().attr("datetime");
            // Upstream #18165: when a chapter title carries a season marker
            // ("Season 2 Chapter 5", "S2 Ch. 5"), the first number in the string is
            // the season, not the chapter, so naive parsing collapses every season
            // onto the same number. Fall back to the item's position in the
            // descending list instead.
            const chapNum = SEASON_REGEX.test(name)
                ? total - index
                : this.parseChapterNumber(name);
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum,
                publishDate: this.parseDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = `${this.chapterUrl(chapter.chapterId)}/images?is_prev=False&reading_style=long_strip`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        // NOTE: cheerio's `[attr~=val]` is a whitespace-separated WORD match,
        // unlike Jsoup's regex match used upstream. The section's x-data only
        // contains tokens like `scrollDown()`, never a bare `scroll`, so `~=`
        // matched nothing and returned an empty page list (reader crash). Use a
        // substring match instead.
        $("section[x-data*=scroll] > img").each((_, element) => {
            const src = $(element).attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
        });
        if (pages.length === 0) {
            throw new Error("No pages found for this chapter; the reader layout may have changed.");
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
    sourceImg(scope) {
        const srcset = scope.find("source").first().attr("srcset");
        if (srcset) {
            return this.absoluteUrl(srcset.replace("small", "normal"));
        }
        const src = scope.find("img").first().attr("src");
        if (src)
            return this.absoluteUrl(src);
        return "";
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
        const s = (status || "").toLowerCase().trim();
        if (s === "ongoing")
            return "Ongoing";
        if (s === "complete")
            return "Completed";
        if (s === "hiatus")
            return "Hiatus";
        if (s === "canceled")
            return "Cancelled";
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
export const WeebCentral = new WeebCentralExtension();
