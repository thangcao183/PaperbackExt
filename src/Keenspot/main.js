import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://twokinds.keenspot.com";
const ARTIST = "Tom Fischbach";
// The two single-webcomic entries exposed by this source.
const ENTRIES = [
    {
        mangaId: "1",
        title: "TwoKinds (1 page per chapter)",
        thumbnail: "https://dummyimage.com/768x994/000/ffffff.jpg&text=TwoKinds (1 page per chapter)",
    },
    {
        mangaId: "20",
        title: "TwoKinds (20 pages per chapter)",
        thumbnail: "https://dummyimage.com/768x994/000/ffffff.jpg&text=TwoKinds (20 pages per chapter)",
    },
];
const CHUNK_SIZE = 20;
class KeenspotInterceptor extends PaperbackInterceptor {
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
export class KeenspotExtension {
    requestManager = new KeenspotInterceptor("main");
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
                title: "TwoKinds",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = ENTRIES.map((entry) => ({
            type: "simpleCarouselItem",
            mangaId: entry.mangaId,
            imageUrl: entry.thumbnail,
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
        const items = ENTRIES.filter((entry) => titleQuery === "" || entry.title.toLowerCase().includes(titleQuery)).map((entry) => ({
            mangaId: entry.mangaId,
            imageUrl: entry.thumbnail,
            title: entry.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const entry = ENTRIES.find((e) => e.mangaId === mangaId) ?? ENTRIES[0];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: entry.title,
                secondaryTitles: [],
                thumbnailUrl: entry.thumbnail,
                author: ARTIST,
                artist: ARTIST,
                synopsis: "",
                contentRating: ContentRating.EVERYONE,
                status: "Unknown",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const pages = await this.fetchArchivePages();
        const mode = sourceManga.mangaId;
        // 1 page per chapter
        if (mode === "1") {
            const chapters = pages.map((page, index) => ({
                chapterId: `1-${page.urlPart}`,
                sourceManga,
                title: `Page ${page.name}`,
                volume: 0,
                chapNum: index + 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            }));
            return chapters.reverse();
        }
        // 20 pages per chapter
        const chapters = [];
        for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
            const last = Math.min(pages.length, i + CHUNK_SIZE) - 1;
            chapters.push({
                chapterId: `20-${pages[i].urlPart}`,
                sourceManga,
                title: `Pages ${pages[i].name}-${pages[last].name}`,
                volume: 0,
                chapNum: i / CHUNK_SIZE + 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            });
        }
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const chapterId = chapter.chapterId;
        const firstPart = chapterId.substring(chapterId.indexOf("-") + 1);
        const comicUrls = [];
        if (chapterId.startsWith("1")) {
            comicUrls.push(`${BASE_URL}/comic/${firstPart}/`);
        }
        else {
            const pages = await this.fetchArchivePages();
            const firstPageIdx = pages.findIndex((p) => p.urlPart === firstPart);
            if (firstPageIdx >= 0) {
                const lastPageIdx = Math.min(pages.length, firstPageIdx + CHUNK_SIZE);
                for (let i = firstPageIdx; i < lastPageIdx; i++) {
                    comicUrls.push(`${BASE_URL}/comic/${pages[i].urlPart}/`);
                }
            }
        }
        // Each comic page is an HTML page whose image lives at "#content article img".
        const pages = [];
        for (const url of comicUrls) {
            const $ = await this.fetchCheerio({ url, method: "GET" });
            const src = $("#content article img").first().attr("src") || "";
            if (src)
                pages.push(this.absoluteUrl(src));
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
    async fetchArchivePages() {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/archive/`,
            method: "GET",
        });
        const pages = [];
        $(".chapter-links > a").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            // /comic/1185halloween/ -> 1185halloween
            const parts = href.split("/");
            const urlPart = parts[2] || "";
            if (!urlPart)
                return;
            const name = el.find("span").first().text().trim();
            pages.push({ urlPart, name });
        });
        return pages;
    }
    mangaUrl(mangaId) {
        // The site hosts a single webcomic; the share URL points at the archive.
        void mangaId;
        return `${BASE_URL}/archive/`;
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
export const Keenspot = new KeenspotExtension();
