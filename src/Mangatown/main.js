import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.mangatown.com";
class MangatownInterceptor extends PaperbackInterceptor {
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
export class MangatownExtension {
    requestManager = new MangatownInterceptor("main");
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
        const url = section.id === "popular"
            ? `${BASE_URL}/directory/0-0-0-0-0-0/${page}.htm`
            : `${BASE_URL}/latest/${page}.htm`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("li").each((_, element) => {
            const el = $(element);
            if (el.find("a.manga_cover").length === 0)
                return;
            const parsed = this.itemFromElement($, el);
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a.next:not([href^=javascript])").length > 0;
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
        const url = `${BASE_URL}/search?page=${page}&name=${encodeURIComponent(titleQuery)}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $("li").each((_, element) => {
            const el = $(element);
            if (el.find("a.manga_cover").length === 0)
                return;
            const parsed = this.itemFromElement($, el);
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("a.next:not([href^=javascript])").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    itemFromElement($, el) {
        const link = el.find("p.title a").first();
        const href = link.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = link.text().trim();
        const imageUrl = this.imageFromElement(el.find("img").first());
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
        const info = $("div.article_content");
        const title = info.find("h1").first().text().trim() || this.safeDecode(mangaId);
        const author = this.textAfterLabel($, info, "author");
        const artist = this.textAfterLabel($, info, "artist");
        let licensed = false;
        info.find("div.chapter_content").each((_, el) => {
            if ($(el).text().toLowerCase().includes("has been licensed")) {
                licensed = true;
            }
        });
        const statusText = this.liTextForLabel($, info, "status");
        const status = licensed ? "Cancelled" : this.parseStatus(statusText);
        const genres = [];
        info.find("li").each((_, li) => {
            const $li = $(li);
            const label = $li.find("b").first().text().toLowerCase();
            if (!label.includes("genre"))
                return;
            $li.find("a").each((_i, a) => {
                const g = $(a).text().trim();
                if (g.length > 0)
                    genres.push(g);
            });
        });
        const synopsis = $("span#show")
            .first()
            .text()
            .replace(/HIDE$/, "")
            .trim();
        const thumbnailUrl = this.imageFromElement($("div.detail_info img").first());
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
                status,
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
        $("ul.chapter_list li").each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const extra = el
                .find("span:not(span.time):not(span.new)")
                .map((_i, e) => $(e).text().trim())
                .get()
                .filter((t) => t.length > 0)
                .join(" ");
            const linkText = link.text().trim();
            const name = extra ? `${linkText} ${extra}`.trim() : linkText;
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(linkText),
                publishDate: this.parseDate(el.find("span.time").first().text().trim()),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const pageUrls = [];
        $("select#top_chapter_list ~ div.page_select option").each((_, element) => {
            const $el = $(element);
            // Skip the "Featured" option (jsoup used :not(:contains(featured)),
            // unsupported by Paperback's CSS engine).
            if ($el.text().toLowerCase().includes("featured"))
                return;
            const value = $el.attr("value") || "";
            if (!value)
                return;
            const pageUrl = value.startsWith("http")
                ? value
                : this.absoluteUrl(value);
            pageUrls.push(pageUrl);
        });
        if (pageUrls.length > 0) {
            for (const pageUrl of pageUrls) {
                const $$ = await this.fetchCheerio({ url: pageUrl, method: "GET" });
                const src = this.imageFromElement($$("div#viewer img").first());
                if (src)
                    pages.push(src);
            }
        }
        else {
            $("div#viewer img").each((_, element) => {
                const src = this.imageFromElement($(element));
                if (src)
                    pages.push(src);
            });
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
    // Replaces jsoup `b:containsOwn(label) + a` (Paperback's CSS engine
    // does not support the :containsOwn pseudo-class). Finds the <b> whose
    // own text contains `label`, then returns the text of the following <a>.
    textAfterLabel($, info, label) {
        let result = "";
        info.find("b").each((_, b) => {
            if (result)
                return;
            if (!$(b).text().toLowerCase().includes(label))
                return;
            result = $(b).next("a").first().text().trim();
        });
        return result;
    }
    // Replaces jsoup `li:has(b:containsOwn(label))`. Returns the full text
    // of the first <li> whose <b> own-text contains `label`.
    liTextForLabel($, info, label) {
        let result = "";
        info.find("li").each((_, li) => {
            if (result)
                return;
            const labelText = $(li).find("b").first().text().toLowerCase();
            if (labelText.includes(label))
                result = $(li).text();
        });
        return result;
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
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    parseDate(date) {
        const d = (date || "").trim();
        if (!d)
            return new Date(0);
        if (/today/i.test(d))
            return new Date();
        if (/yesterday/i.test(d)) {
            const yd = new Date();
            yd.setDate(yd.getDate() - 1);
            return yd;
        }
        // Format: "MMM dd,yyyy" e.g. "Jan 05,2020"
        const parsed = new Date(d.replace(",", ", "));
        if (!isNaN(parsed.getTime()))
            return parsed;
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
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
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
export const Mangatown = new MangatownExtension();
