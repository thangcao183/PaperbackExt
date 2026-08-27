import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://multporn.net";
const MANGA_SELECTOR = ".masonry-item";
const NEXT_PAGE_SELECTOR = ".pager-next a";
// Content-type filters, mirroring the upstream "Search Type" select.
const SEARCH_TYPES = [
    { id: "comics", title: "Comics", uri: "1" },
    { id: "hentai-manga", title: "Hentai Manga", uri: "2" },
    { id: "gay-comics", title: "Gay Comics", uri: "3" },
    { id: "cartoon-pictures", title: "Cartoon Pictures", uri: "4" },
    { id: "hentai-pictures", title: "Hentai Pictures", uri: "5" },
    { id: "rule-63", title: "Rule 63", uri: "11" },
    { id: "humor", title: "Humor", uri: "13" },
];
class MultpornInterceptor extends PaperbackInterceptor {
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
export class MultpornExtension {
    requestManager = new MultpornInterceptor("main");
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
                title: "Latest",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "types",
                title: "Browse by Type",
                type: DiscoverSectionType.genres,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id === "types") {
            const items = SEARCH_TYPES.map((t) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { type: t.uri },
                },
                name: t.title,
                metadata: { type: t.uri },
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 0;
        const url = section.id === "popular"
            ? `${BASE_URL}/best?page=${page}&sort_by=totalcount_1`
            : `${BASE_URL}/new?page=${page}&sort_by=created`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $(MANGA_SELECTOR).each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed || seen.has(parsed.mangaId))
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
        const hasNextPage = $(NEXT_PAGE_SELECTOR).first().length > 0;
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
        const page = meta?.page ?? 0;
        const titleQuery = (query.title || "").trim();
        const queryMeta = query.metadata;
        const type = meta?.type ?? queryMeta?.type;
        const params = [];
        params.push(`page=${page}`);
        params.push(`search_api_views_fulltext=${encodeURIComponent(titleQuery)}`);
        params.push(`sort_by=search_api_relevance`);
        if (type)
            params.push(`type=${encodeURIComponent(type)}`);
        const url = `${BASE_URL}/search?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $(MANGA_SELECTOR).each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed || seen.has(parsed.mangaId))
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
        const hasNextPage = $(NEXT_PAGE_SELECTOR).first().length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1, type } : undefined,
        };
    }
    itemFromElement($, el) {
        const link = el.find(".views-field-title a").first();
        const href = link.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = el.find(".views-field-title").first().text().trim();
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
        const title = $("h1#page-title").first().text().trim();
        const infoFor = (label) => $(`.field:has(.field-label:contains(${label}:)) .links a`)
            .map((_, a) => $(a).text().trim())
            .get()
            .filter((t) => t.length > 0);
        const sections = infoFor("Section");
        const characters = infoFor("Characters");
        const tags = infoFor("Tags");
        const authorsLabelled = infoFor("Author");
        const unlabelledAuthors = [];
        for (const cls of [
            "field-name-field-author",
            "field-name-field-authors-gr",
            "field-name-field-img-group",
            "field-name-field-hentai-img-group",
            "field-name-field-rule-63-section",
        ]) {
            $(`.${cls} a`).each((_, a) => {
                const t = $(a).text().trim();
                if (t)
                    unlabelledAuthors.push(t);
            });
        }
        const artist = Array.from(new Set([...authorsLabelled, ...unlabelledAuthors])).join(", ");
        const status = sections.some((s) => s === "Ongoings")
            ? "Ongoing"
            : "Completed";
        const pageCount = $(".jb-image img").length;
        const descParts = [];
        if (sections.length > 0)
            descParts.push(`Section:\n${sections.join(", ")}`);
        if (characters.length > 0)
            descParts.push(`Characters:\n${characters.join(", ")}`);
        descParts.push(`Pages:\n${pageCount}`);
        const synopsis = descParts.join("\n\n");
        const thumbnailUrl = this.imageFromElement($(".jb-image img").first());
        const tagGroups = [];
        const allGenres = Array.from(new Set([...tags, ...sections, ...characters]));
        if (allGenres.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: allGenres.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title || this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl,
                author: artist || undefined,
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
        // Multporn entries are single galleries; expose one chapter that points
        // back at the manga page itself.
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter",
                volume: 0,
                chapNum: 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $(".jb-image img").each((_, element) => {
            const raw = $(element).attr("src") || "";
            if (!raw)
                return;
            const cleaned = this.absoluteUrl(raw)
                .replace("/styles/juicebox_2k/public", "")
                .split("?")[0];
            if (cleaned)
                pages.push(cleaned);
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
export const Multporn = new MultpornExtension();
