import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { GENRE_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS, WebcomicsSearchForm, } from "./forms";
const BASE_URL = "https://webcomicsapp.com";
const API_URL = "https://official-website-api.webcomicsapp.com/api/web/v4/book";
const LANG = "en";
// Upstream derives every browse path segment from the filter titles, so the
// first entry of each list doubles as the "no filter" default.
const DEFAULT_GENRE = GENRE_OPTIONS[0].id;
const DEFAULT_STATUS = STATUS_OPTIONS[0].id;
const GENRE_TITLE_SEGMENT = "genres";
// The status option whose presence marks a title as still releasing.
const ONGOING_STATUS = STATUS_OPTIONS[1].title;
class WebcomicsInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
export class WebcomicsExtension {
    requestManager = new WebcomicsInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 3,
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
                title: "Newest",
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
            const items = GENRE_OPTIONS.map((genre) => ({
                type: "genresCarouselItem",
                name: genre.title,
                searchQuery: {
                    title: "",
                    metadata: { searchMeta: { genre: [genre.id] } },
                },
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        // Popular uses the first sort option, latest the last one.
        const sort = section.id === "popular"
            ? SORT_OPTIONS[0].id
            : SORT_OPTIONS[SORT_OPTIONS.length - 1].id;
        const url = this.browseUrl(DEFAULT_GENRE, DEFAULT_STATUS, sort, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const parsed = this.parseListing($);
        const items = parsed.items.map((item) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: item.mangaId,
            imageUrl: item.imageUrl,
            title: item.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getAdvancedSearchForm(query) {
        const meta = query.metadata;
        return new WebcomicsSearchForm(meta?.searchMeta);
    }
    async getSearchResults(query, metadata) {
        const titleQuery = (query.title || "").trim();
        const meta = metadata;
        const page = meta?.page ?? 1;
        // Text search is a dedicated endpoint that ignores the filters entirely.
        if (titleQuery !== "") {
            const url = `${BASE_URL}/${LANG}/search?q=${encodeURIComponent(titleQuery)}`;
            const $ = await this.fetchCheerio({ url, method: "GET" });
            return { items: this.parseListing($).items, metadata: undefined };
        }
        const searchMeta = query.metadata?.searchMeta;
        const url = this.browseUrl(searchMeta?.genre?.[0] ?? DEFAULT_GENRE, searchMeta?.status?.[0] ?? DEFAULT_STATUS, searchMeta?.sort?.[0] ?? SORT_OPTIONS[0].id, page);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const parsed = this.parseListing($);
        return {
            items: parsed.items,
            metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const ref = this.parseMangaId(mangaId);
        const json = await this.fetchJson(`${API_URL}/info`, {
            book_id: ref.bookId,
        });
        const data = json.data ?? {};
        const genres = (data.category ?? []).filter((g) => g.length > 0);
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
                primaryTitle: data.name ?? ref.name,
                secondaryTitles: [],
                thumbnailUrl: this.absoluteUrl(data.cover ?? ""),
                author: data.author,
                synopsis: data.description ?? "",
                contentRating: ContentRating.EVERYONE,
                status: data.status === ONGOING_STATUS ? "Ongoing" : "Completed",
                tagGroups,
                shareUrl: this.mangaUrl(ref),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const ref = this.parseMangaId(sourceManga.mangaId);
        const json = await this.fetchJson(`${API_URL}/chapter/list`, { book_id: ref.bookId, page: 1, size: 9999, sort: "desc" });
        const chapters = [];
        for (const entry of json.data?.list ?? []) {
            const chapterId = entry.chapter_id;
            if (!chapterId)
                continue;
            const name = entry.name ?? "";
            const index = entry.index ?? 0;
            chapters.push({
                // The reader page URL needs the chapter index too, so keep both.
                chapterId: `${chapterId}|${index}`,
                sourceManga,
                title: entry.is_pay ? `🔒 ${name}` : name,
                volume: 0,
                chapNum: index,
                publishDate: entry.update_time
                    ? new Date(entry.update_time)
                    : new Date(0),
                langCode: "🇬🇧",
            });
        }
        return chapters.sort((a, b) => b.chapNum - a.chapNum);
    }
    async getChapterDetails(chapter) {
        const ref = this.parseMangaId(chapter.sourceManga.mangaId);
        const [chapterId, indexPart] = chapter.chapterId.split("|");
        const index = parseInt(indexPart ?? "", 10);
        const json = await this.fetchJson(`${API_URL}/chapter/detail`, {
            book_id: ref.bookId,
            chapter_id: chapterId,
            index: isNaN(index) ? chapter.chapNum : index,
        });
        const baseUrl = json.data?.base_url ?? "";
        const pages = [];
        for (const image of json.data?.images ?? []) {
            const url = image.url ?? "";
            if (!url)
                continue;
            pages.push(url.startsWith("http") ? url : `${baseUrl}${url}`);
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(this.parseMangaId(mangaId));
    }
    // ----------------------------------------------------------------
    // Listing parsing
    // ----------------------------------------------------------------
    parseListing($) {
        // Thumbnails are sometimes only present in the Nuxt payload.
        const nuxtData = $("script#__NUXT_DATA__").first().contents().text();
        const items = [];
        const seen = new Set();
        $(".grid > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            // Hrefs look like /<lang>/<slug>/<name>/<bookId>.
            const segments = this.safeDecode(href)
                .replace(/[?#].*$/, "")
                .replace(/^https?:\/\/[^/]+/, "")
                .split("/")
                .filter((s) => s.length > 0);
            if (segments.length < 4)
                return;
            const ref = {
                slug: segments[1],
                name: segments[2],
                bookId: segments[3],
            };
            const mangaId = this.toMangaId(ref);
            if (seen.has(mangaId))
                return;
            const title = el
                .find("p.text-ink,span[class*=text]")
                .first()
                .text()
                .trim();
            if (!title)
                return;
            seen.add(mangaId);
            items.push({
                mangaId,
                imageUrl: this.thumbnailFor(el.find("img[src]").first(), ref, nuxtData),
                title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        // The current page is a non-clickable span; a following anchor means there
        // is at least one more page.
        const hasNextPage = $("div > span.cursor-default.bg-primary + a").length > 0;
        return { items, hasNextPage };
    }
    thumbnailFor(img, ref, nuxtData) {
        const src = this.imageFromElement(img);
        if (src.startsWith("http"))
            return src;
        if (!nuxtData)
            return src;
        // Nuxt serialises the cover a few slots after the book id.
        const escaped = ref.bookId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = new RegExp(`"${escaped}"[^"]*"[^"]*"[^"]*"(https[^"]+)"`).exec(nuxtData);
        return match ? match[1] : src;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    browseUrl(genre, status, sort, page) {
        return [
            BASE_URL,
            LANG,
            GENRE_TITLE_SEGMENT,
            this.toPathSegment(genre),
            this.toPathSegment(status),
            this.toPathSegment(sort),
            String(page),
        ].join("/");
    }
    toPathSegment(value) {
        return value
            .replace(/[!-/:-@[-`{-~]/g, "")
            .replace(/\s+/g, "-")
            .toLowerCase();
    }
    toMangaId(ref) {
        return [ref.bookId, ref.slug, ref.name].join("|");
    }
    parseMangaId(mangaId) {
        const [bookId, slug, name] = this.safeDecode(mangaId).split("|");
        return { bookId: bookId ?? "", slug: slug ?? "", name: name ?? "" };
    }
    mangaUrl(ref) {
        return [BASE_URL, LANG, ref.slug, ref.name, ref.bookId].join("/");
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
    async fetchJson(url, body) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        return JSON.parse(Application.arrayBufferToUTF8String(data));
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
export const Webcomics = new WebcomicsExtension();
