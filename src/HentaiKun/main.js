import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://hentaikun.com";
const MANGA_URL = `${BASE_URL}/manga`;
const CHAPTER_NUMBER_REGEX = /(\d+(?:\.\d+)?)/;
const TRAILING_DIGITS_REGEX = /\d+$/;
class HentaiKunInterceptor extends PaperbackInterceptor {
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
export class HentaiKunExtension {
    requestManager = new HentaiKunInterceptor("main");
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
                id: "most-viewed",
                title: "Most Viewed",
                type: DiscoverSectionType.featured,
            },
            {
                id: "last-updated",
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const pageStr = page > 1 ? `${page}/` : "";
        const url = `${MANGA_URL}/manga-list/${section.id}/${pageStr}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const parsed = this.parseListing($);
        const items = parsed.map((entry) => ({
            type: section.id === "most-viewed"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            metadata: undefined,
        }));
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
        const pageStr = page > 1 ? `${page}/` : "";
        const titleQuery = (query.title || "").trim();
        let url;
        if (titleQuery) {
            url = `${MANGA_URL}/search/title/${encodeURIComponent(titleQuery)}/${pageStr}`;
        }
        else {
            url = `${MANGA_URL}/manga-list/most-viewed/${pageStr}`;
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const parsed = this.parseListing($);
        const items = parsed.map((entry) => ({
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = this.hasNextPage($);
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $("div.single_title h1").first().text().trim() ||
            this.safeDecode(mangaId);
        const thumbnailUrl = this.absoluteUrl($("meta[property='og:image']").first().attr("content") || "");
        const authors = $("h2:has(strong:contains(Artist)) a")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0);
        const author = authors.length > 0 ? authors.join(", ") : undefined;
        const category = $("h2:has(strong:contains(Category)) a")
            .first()
            .text()
            .trim();
        const tags = $("div.desc a[href*='/tag/'] span.label-danger")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0);
        const genres = [];
        if (category)
            genres.push(category);
        genres.push(...tags);
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
                synopsis: "",
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
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        const seen = new Set();
        $("table a.readchap").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = el.text().trim() || "Chapter";
            const row = el.closest("tr");
            const dateText = row.find("td:last-child h6").first().text().trim();
            chapters.push({
                chapterId,
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
        const firstImageUrl = ($("img.image_rin").first().attr("src") || "").trim();
        if (!firstImageUrl) {
            throw new Error("Could not find any images for this chapter.");
        }
        let totalPages = $("label:contains(Page) + select option").length;
        if (totalPages === 0) {
            totalPages = $("select[onchange]").last().find("option").length;
        }
        const pages = [];
        if (totalPages === 0) {
            pages.push(this.absoluteUrl(firstImageUrl));
            return {
                id: chapter.chapterId,
                mangaId: chapter.sourceManga.mangaId,
                pages,
            };
        }
        const lastSlash = firstImageUrl.lastIndexOf("/");
        const basePath = firstImageUrl.substring(0, lastSlash + 1);
        const fileFull = firstImageUrl.substring(lastSlash + 1);
        const lastDot = fileFull.lastIndexOf(".");
        const fileName = lastDot >= 0 ? fileFull.substring(0, lastDot) : fileFull;
        const ext = lastDot >= 0 ? fileFull.substring(lastDot + 1) : "";
        const prefix = fileName.replace(TRAILING_DIGITS_REGEX, "");
        const numberPart = fileName.substring(prefix.length);
        const padLength = numberPart.length;
        for (let i = 1; i <= totalPages; i++) {
            const pageNum = padLength > 0 ? String(i).padStart(padLength, "0") : String(i);
            pages.push(this.absoluteUrl(`${basePath}${prefix}${pageNum}.${ext}`));
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
    // Listing parser
    // ----------------------------------------------------------------
    parseListing($) {
        const results = [];
        const seen = new Set();
        if ($("table.table-striped").length > 0) {
            $("table.table-striped tr:not(.danger)").each((_, element) => {
                const row = $(element);
                const anchor = row.find("td:first-child a").first();
                const href = anchor.attr("href") || "";
                if (!href)
                    return;
                const mangaId = this.parsePath(href);
                if (!mangaId || seen.has(mangaId))
                    return;
                const title = anchor.text().trim();
                if (!title)
                    return;
                const imageUrl = this.imageFromTitleAttr(anchor.attr("title") || "");
                seen.add(mangaId);
                results.push({ mangaId, imageUrl, title });
            });
        }
        else {
            $("div.thumbnail[id^='galary-']").each((_, element) => {
                const div = $(element);
                const overlayAnchor = div.find("div.overlay a").first();
                const href = overlayAnchor.attr("href") || "";
                if (!href)
                    return;
                const mangaId = this.parsePath(href);
                if (!mangaId || seen.has(mangaId))
                    return;
                const title = overlayAnchor.text().trim();
                if (!title)
                    return;
                const imageUrl = this.imageFromElement(div.find("img.img-responsive").first());
                seen.add(mangaId);
                results.push({ mangaId, imageUrl, title });
            });
        }
        return results;
    }
    hasNextPage($) {
        return $("ul.pagination li[aria-label=Next]").length > 0;
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
        const m = name.match(CHAPTER_NUMBER_REGEX);
        return m ? parseFloat(m[1]) : 1;
    }
    parseDate(text) {
        const m = text.match(/(\d{2})-(\d{2})-(\d{4})/);
        if (!m)
            return new Date(0);
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const year = parseInt(m[3], 10);
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? new Date(0) : d;
    }
    imageFromTitleAttr(titleHtml) {
        if (!titleHtml)
            return "";
        const dom = htmlparser2.parseDocument(titleHtml);
        const $frag = cheerio.load(dom);
        return this.imageFromElement($frag("img").first());
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
export const HentaiKun = new HentaiKunExtension();
