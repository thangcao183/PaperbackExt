import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://xyzcomics.com";
// Prefix used to tag genre chips so tapping one routes to its dedicated tag
// listing instead of a plain title search. Mirrors upstream ArtistTagFilter.
const TAG_GENRE_PREFIX = "tag:";
class XYZComicsInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        return request;
    }
    async interceptResponse(request, response, data) {
        if (response.headers?.["cf-mitigated"] === "challenge") {
            throw new CloudflareError({
                url: request.url,
                method: request.method ?? "GET",
                headers: { "user-agent": await Application.getDefaultUserAgent() },
            });
        }
        return data;
    }
}
class XYZComicsExtension {
    requestManager = new XYZComicsInterceptor("main");
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
    async getDiscoverSections() {
        return [
            {
                id: "allsexkomix",
                title: "All Comix",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        const url = page === 1
            ? `${BASE_URL}/${section.id}/`
            : `${BASE_URL}/${section.id}/page/${page}/`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const { items, hasNextPage } = this.parseMangaList($);
        return {
            items: items.map((item) => ({
                type: "simpleCarouselItem",
                mangaId: item.mangaId,
                imageUrl: item.imageUrl,
                title: item.title,
                metadata: undefined,
            })),
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        let url;
        if (titleQuery.startsWith(TAG_GENRE_PREFIX)) {
            const slug = this.slugify(this.safeDecode(titleQuery.slice(TAG_GENRE_PREFIX.length)));
            url =
                page === 1
                    ? `${BASE_URL}/tag/${slug}/`
                    : `${BASE_URL}/tag/${slug}/page/${page}/`;
        }
        else {
            const q = encodeURIComponent(titleQuery);
            url =
                page === 1
                    ? `${BASE_URL}/?s=${q}`
                    : `${BASE_URL}/page/${page}/?s=${q}`;
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const { items, hasNextPage } = this.parseMangaList($);
        return {
            items: items.map((item) => ({
                mangaId: item.mangaId,
                title: item.title,
                imageUrl: item.imageUrl,
                metadata: undefined,
            })),
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    async getMangaDetails(mangaId) {
        const $ = await this.fetchCheerio({
            url: this.mangaUrl(mangaId),
            method: "GET",
        });
        const title = $("h1.post-title a, h1.post-title").first().text().trim() ||
            $("title").first().text().trim();
        const thumbnailUrl = this.absoluteUrl($(".pswp-gallery .pswp-gallery__item a[href]").first().attr("href") || "");
        const genres = [];
        $("a.post-tag-button").each((_, el) => {
            const t = $(el).text().trim();
            if (t)
                genres.push(t);
        });
        const tagGroups = genres.length > 0
            ? [
                {
                    id: "genres",
                    title: "Tags",
                    tags: genres.map((g) => ({
                        id: `${TAG_GENRE_PREFIX}${this.toSafeId(g)}`,
                        title: g,
                    })),
                },
            ]
            : [];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                synopsis: "",
                contentRating: ContentRating.ADULT,
                status: "Unknown",
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    async getChapters(sourceManga) {
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter 1",
                volume: 0,
                chapNum: 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const $ = await this.fetchCheerio({
            url: this.chapterUrl(chapter.chapterId),
            method: "GET",
        });
        const pages = [];
        $(".pswp-gallery .pswp-gallery__item a[href]").each((_, el) => {
            const href = this.absoluteUrl($(el).attr("href") || "");
            if (href)
                pages.push(href.replace(/ /g, "%20"));
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
    // ---- helpers ----
    parseMangaList($) {
        const items = [];
        $("article.post").each((_, el) => {
            const article = $(el);
            const thumbLink = article.find("figure.post-image a").first();
            const titleEl = article.find("h2.post-title a").first();
            const href = thumbLink.attr("href");
            const title = titleEl.text().trim();
            if (!href || !title)
                return;
            const img = article.find("figure.post-image img.wp-post-image").first();
            items.push({
                mangaId: this.parsePath(href),
                title,
                imageUrl: img.length ? this.imageFromElement(img) : "",
            });
        });
        const hasNextPage = $("a.nextp, .pagenav a.next, a.page-numbers.next, a[rel=next]").length >
            0;
        return { items, hasNextPage };
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    chapterUrl(chapterId) {
        return this.mangaUrl(chapterId);
    }
    parsePath(href) {
        const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
        const slug = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        return this.toSafeId(slug);
    }
    slugify(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/^-+|-+$/g, "");
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
        return this.absoluteUrl(src).replace(/ /g, "%20");
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
export const XYZComics = new XYZComicsExtension();
