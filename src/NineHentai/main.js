import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://9hentai.so";
const SEARCH_URL = "/api/getBook";
const MANGA_URL = "/api/getBookByID";
const SORT_LATEST = 0;
const SORT_POPULAR = 1;
class NineHentaiInterceptor extends PaperbackInterceptor {
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
export class NineHentaiExtension {
    requestManager = new NineHentaiInterceptor("main");
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
                title: "Popular Right Now",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "Newest",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? SORT_POPULAR : SORT_LATEST;
        const { mangas, hasNext } = await this.fetchSearch({ page, sort });
        const items = mangas.map((m) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: String(m.id),
            imageUrl: this.thumbnailUrl(m),
            title: m.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: hasNext ? { page: page + 1, sort } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        let titleQuery = (query.title || "").trim();
        // Support direct id lookups via a full URL or an "id:" prefixed query.
        if (titleQuery.startsWith("https://")) {
            const m = titleQuery.match(/\/g\/(\d+)/);
            if (m) {
                titleQuery = `id:${m[1]}`;
            }
            else {
                return { items: [], metadata: undefined };
            }
        }
        if (titleQuery.startsWith("id:")) {
            const id = parseInt(titleQuery.slice(3).trim(), 10);
            if (isNaN(id))
                return { items: [], metadata: undefined };
            const manga = await this.fetchSingleManga(id);
            if (!manga)
                return { items: [], metadata: undefined };
            return {
                items: [
                    {
                        mangaId: String(manga.id),
                        imageUrl: this.thumbnailUrl(manga),
                        title: manga.title,
                        subtitle: undefined,
                        metadata: undefined,
                    },
                ],
                metadata: undefined,
            };
        }
        const { mangas, hasNext } = await this.fetchSearch({
            page,
            sort: SORT_LATEST,
            text: titleQuery,
        });
        const items = mangas.map((m) => ({
            mangaId: String(m.id),
            imageUrl: this.thumbnailUrl(m),
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items,
            metadata: hasNext ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const info = $("div#bigcontainer").first();
        const title = info.find("h1").first().text().trim() || mangaId;
        const thumbnailUrl = this.absoluteUrl(info.find("div#cover v-lazy-image").first().attr("src") || "");
        const artist = this.selectText($, info, "div.field-name:contains(Artist:) a.tag");
        const author = this.selectText($, info, "div.field-name:contains(Group:) a.tag") ||
            "Unknown circle";
        const genre = this.selectText($, info, "div.field-name:contains(Tag:) a.tag");
        const descriptionParts = [];
        const altTitle = info.find("h2").first().text().trim();
        if (altTitle)
            descriptionParts.push(`Alternative Title: ${altTitle}`);
        const pages = info.find("div#info > div:contains(pages)").first().text().trim();
        if (pages)
            descriptionParts.push(`Pages: ${pages}`);
        const parody = this.selectText($, info, "div.field-name:contains(Parody:) a.tag");
        if (parody)
            descriptionParts.push(`Parody: ${parody}`);
        const category = this.selectText($, info, "div.field-name:contains(Category:) a.tag");
        if (category)
            descriptionParts.push(`Category: ${category}`);
        const language = this.selectText($, info, "div.field-name:contains(Language:) a.tag");
        if (language)
            descriptionParts.push(`Language: ${language}`);
        const tagGroups = genre
            ? [
                {
                    id: "tags",
                    title: "Tags",
                    tags: genre
                        .split(",")
                        .map((t) => t.trim())
                        .filter((t) => t.length > 0)
                        .map((t) => ({
                        id: t.toLowerCase().replace(/\s+/g, "-"),
                        title: t,
                    })),
                },
            ]
            : [];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: altTitle ? [altTitle] : [],
                thumbnailUrl,
                author,
                artist: artist || undefined,
                synopsis: descriptionParts.join("\n\n"),
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
        const time = $("div#info div time").first().text().trim();
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter",
                volume: 0,
                chapNum: 1,
                publishDate: this.parseChapterDate(time),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const id = parseInt(chapter.sourceManga.mangaId, 10);
        const manga = await this.fetchSingleManga(id);
        if (!manga) {
            return {
                id: chapter.chapterId,
                mangaId: chapter.sourceManga.mangaId,
                pages: [],
            };
        }
        const imageBase = this.getImageUrl(manga);
        let totalPages = manga.total_page;
        // The last preview thumbnail may 404 when the real count is one less.
        try {
            const [response] = await Application.scheduleRequest({
                url: `${imageBase}/preview/${totalPages}t.jpg`,
                method: "GET",
            });
            if (response.status === 404)
                totalPages--;
        }
        catch {
            // Ignore probe failures and trust the reported count.
        }
        const pages = [];
        for (let i = 1; i <= totalPages; i++) {
            pages.push(`${imageBase}/${i}.jpg`);
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
    // API helpers
    // ----------------------------------------------------------------
    async fetchSearch(opts) {
        const payload = {
            search: {
                text: opts.text ?? "",
                page: opts.page - 1, // Source counts pages from 0.
                sort: opts.sort,
                pages: { range: [0, 2000] },
                tag: { items: { included: [], excluded: [] } },
            },
        };
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}${SEARCH_URL}?req_page=${opts.page}`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (response.status === 404) {
            return { mangas: [], hasNext: false };
        }
        const parsed = this.parseJson(data);
        const mangas = parsed?.results ?? [];
        const totalCount = parsed?.total_count ?? 0;
        return { mangas, hasNext: totalCount > opts.page };
    }
    async fetchSingleManga(id) {
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}${MANGA_URL}`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id }),
        });
        if (response.status === 404)
            return undefined;
        const parsed = this.parseJson(data);
        return parsed?.results;
    }
    parseJson(data) {
        try {
            return JSON.parse(Application.arrayBufferToUTF8String(data));
        }
        catch {
            return undefined;
        }
    }
    thumbnailUrl(m) {
        return `${m.image_server}${m.id}/cover-small.jpg`;
    }
    getImageUrl(m) {
        return `${m.image_server}${m.id}`;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        if (/^\d+$/.test(slug))
            return `${BASE_URL}/g/${slug}`;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    selectText($, root, selector) {
        const list = root.find(selector);
        if (list.length === 0)
            return "";
        return list
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0)
            .join(", ");
    }
    parseChapterDate(date) {
        const parts = date.split(" ");
        const value = parseInt(parts[0] ?? "", 10);
        if (isNaN(value))
            return new Date(0);
        const unit = (parts[1] ?? "").replace(/s$/, "");
        const now = Date.now();
        const sec = 1000;
        const min = 60 * sec;
        const hour = 60 * min;
        const day = 24 * hour;
        switch (unit) {
            case "sec":
                return new Date(now - value * sec);
            case "min":
                return new Date(now - value * min);
            case "hour":
                return new Date(now - value * hour);
            case "day":
                return new Date(now - value * day);
            case "week":
                return new Date(now - value * 7 * day);
            case "month":
                return new Date(now - value * 30 * day);
            case "year":
                return new Date(now - value * 365 * day);
            default:
                return new Date(0);
        }
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
export const NineHentai = new NineHentaiExtension();
