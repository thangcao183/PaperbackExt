import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://explosm.net";
const ARCHIVE_PAGE = `${BASE_URL}/comics`;
const THUMBNAIL = "https://vhx.imgix.net/vitalyuncensored/assets/13ea3806-5ebf-4987-bcf1-82af2b689f77/S2E4_Still1.jpg";
const AUTHOR = "Explosm.net";
const DESCRIPTION = "Cyanide & Happiness - the long-running webcomic from Explosm.net. Each entry collects the comics published in a single year.";
class CyanideHappinessInterceptor extends PaperbackInterceptor {
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
export class CyanideHappinessExtension {
    requestManager = new CyanideHappinessInterceptor("main");
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
                id: "archive",
                title: "Archive by Year",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const years = await this.getArchiveYears();
        const items = years.map((year) => ({
            type: "simpleCarouselItem",
            mangaId: year,
            imageUrl: THUMBNAIL,
            title: `C&H ${year}`,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const years = await this.getArchiveYears();
        const items = [];
        for (const year of years) {
            const title = `C&H ${year}`;
            if (titleQuery === "" || title.toLowerCase().includes(titleQuery)) {
                items.push({
                    mangaId: year,
                    imageUrl: THUMBNAIL,
                    title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            }
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const year = this.safeDecode(mangaId);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: `C&H ${year}`,
                secondaryTitles: [],
                thumbnailUrl: THUMBNAIL,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: DESCRIPTION,
                contentRating: ContentRating.EVERYONE,
                status: "Completed",
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const year = this.safeDecode(sourceManga.mangaId);
        const archive = await this.fetchArchiveData();
        const months = archive[year];
        if (!months)
            return [];
        const entries = [];
        for (const monthKey of Object.keys(months)) {
            const comics = months[monthKey] || [];
            for (const comic of comics) {
                const slug = comic.slug ?? "";
                if (!slug)
                    continue;
                const imageUrl = this.resolveImageUrl(comic);
                entries.push({
                    slug,
                    imageUrl,
                    date: this.parseDate(comic.publish_at),
                });
            }
        }
        // Upstream flattens then reverses (newest first).
        entries.reverse();
        return entries.map((entry, index) => ({
            chapterId: this.toSafeId(`${entry.slug}#${entry.imageUrl}`),
            sourceManga,
            title: entry.slug,
            volume: 0,
            chapNum: entries.length - index,
            publishDate: entry.date,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const imageUrl = decoded.substring(decoded.indexOf("#") + 1);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: imageUrl ? [this.absoluteUrl(imageUrl)] : [],
        };
    }
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(mangaId);
    }
    // ----------------------------------------------------------------
    // Archive data fetching
    // ----------------------------------------------------------------
    async getArchiveYears() {
        const archive = await this.fetchArchiveData();
        // Newest first, matching upstream's reversed popular list.
        return Object.keys(archive).reverse();
    }
    async fetchArchiveData() {
        const $ = await this.fetchCheerio({ url: ARCHIVE_PAGE, method: "GET" });
        let scriptSrc = "";
        $("head > script[src]").each((_, el) => {
            const src = $(el).attr("src") || "";
            if (src)
                scriptSrc = src;
        });
        if (!scriptSrc)
            throw new Error("Could not locate Next.js data script");
        // /_next/static/<build>/<file>.js -> /_next/data/<build>/comics.json
        const dataPath = scriptSrc
            .replace("static", "data")
            .replace(/\/[^/]*$/, "/comics.json");
        const jsonUrl = this.absoluteUrl(dataPath);
        const [, data] = await Application.scheduleRequest({
            url: jsonUrl,
            method: "GET",
        });
        const parsed = JSON.parse(Application.arrayBufferToUTF8String(data));
        const archive = parsed?.pageProps?.comicArchiveData;
        if (!archive || typeof archive !== "object") {
            throw new Error("Could not parse comicArchiveData");
        }
        return archive;
    }
    resolveImageUrl(comic) {
        const fileStatic = comic.file_static;
        const file = comic.file ?? "";
        if (fileStatic && fileStatic !== "null") {
            return fileStatic;
        }
        if (file.startsWith("http")) {
            return file;
        }
        return `https://files.explosm.net/comics/${file}`;
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        // Format: "yyyy-MM-dd HH:mm:ss"
        const iso = value.replace(" ", "T") + "Z";
        const t = Date.parse(iso);
        return isNaN(t) ? new Date(0) : new Date(t);
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const year = this.safeDecode(mangaId);
        if (year.startsWith("http"))
            return year;
        return `${ARCHIVE_PAGE}#${year}-01`;
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
export const CyanideHappiness = new CyanideHappinessExtension();
