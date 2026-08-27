import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { getBasicAuthHeader, MadokamiSettingsForm } from "./settings";
const BASE_URL = "https://manga.madokami.al";
class MadokamiInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        const authHeader = getBasicAuthHeader();
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
            ...(authHeader ? { authorization: authHeader } : {}),
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
        if (response.status === 401) {
            throw new Error("You are currently logged out. Go to the source settings to enter " +
                "your Madokami username and password.");
        }
        return data;
    }
}
export class MadokamiExtension {
    requestManager = new MadokamiInterceptor("main");
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
    async getSettingsForm() {
        return new MadokamiSettingsForm();
    }
    // ----------------------------------------------------------------
    // Discover sections
    // ----------------------------------------------------------------
    async getDiscoverSections() {
        return [
            {
                id: "recent",
                title: "Recent",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section) {
        const $ = await this.fetchCheerio({
            url: `${BASE_URL}/recent`,
            method: "GET",
        });
        const items = [];
        const seen = new Set();
        $("table.mobile-files-table tbody tr td:nth-child(1) a:nth-child(1)").each((_, element) => {
            const parsed = this.itemFromAnchor($, $(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query) {
        const titleQuery = (query.title || "").trim();
        const url = `${BASE_URL}/search?q=${encodeURIComponent(titleQuery)}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $("div.container table tbody tr td:nth-child(1) a:nth-child(1)").each((_, element) => {
            const parsed = this.itemFromAnchor($, $(element));
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
        return { items: results, metadata: undefined };
    }
    // Mirrors mangaFromElement in the upstream Kotlin: the title is derived from
    // the URL path segments (skipping leading "!" segments), not from the page.
    itemFromAnchor(_$, el) {
        const href = el.attr("href") || "";
        if (!href)
            return undefined;
        // Mirrors upstream mangaFromElement: archive files (.zip/.cbz/...) are
        // individual downloads, not series, so they are skipped.
        if (this.isArchiveUrl(href))
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = this.titleFromPath(mangaId);
        if (!title)
            return undefined;
        return { mangaId, imageUrl: "", title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.detailsUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const author = $('a[itemprop="author"]')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((a) => a.length > 0)
            .join(", ");
        const genres = $("div.genres a.tag")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((g) => g.length > 0);
        const scanStatus = $("span.scanstatus").first().text().trim();
        const status = scanStatus === "Yes" ? "Completed" : "Unknown";
        const thumbnailUrl = this.imageFromElement($('div.manga-info img[itemprop="image"]').first());
        const title = this.titleFromPath(mangaId) || this.safeDecode(mangaId);
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
                artist: author || undefined,
                synopsis: "",
                contentRating: ContentRating.EVERYONE,
                status,
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
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
        $("table#index-table > tbody > tr > td:nth-child(6) > a").each((_, element) => {
            const row = $(element).parent().parent();
            const readerHref = row.find("td:nth-child(6) a").attr("href") || "";
            if (!readerHref)
                return;
            const idx = readerHref.indexOf("/reader");
            const readerPath = idx >= 0 ? `/reader${readerHref.substring(idx + "/reader".length)}` : "";
            if (!readerPath)
                return;
            const chapterId = this.toSafeId(this.safeDecode(readerPath));
            if (seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = row.find("td:nth-child(1) a").text().trim();
            const dateText = row.find("td:nth-child(3)").text().trim();
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
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const reader = $("div#reader").first();
        const path = reader.attr("data-path") || "";
        const filesAttr = reader.attr("data-files") || "[]";
        const pages = [];
        let files;
        try {
            files = JSON.parse(filesAttr);
        }
        catch {
            files = [];
        }
        if (Array.isArray(files)) {
            for (const file of files) {
                if (typeof file !== "string")
                    continue;
                // Mirrors upstream pageListParse: OkHttp's addEncodedQueryParameter
                // adds URLEncoder.encode(value) verbatim (single-encoded). The query
                // value the server expects is therefore a single percent-encoding.
                const pageUrl = `${BASE_URL}/reader/image` +
                    `?path=${encodeURIComponent(path)}` +
                    `&file=${encodeURIComponent(file)}`;
                pages.push(pageUrl);
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
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    // Mirrors mangaDetailsRequest: for /Manga/<single-char>/... trim to 5 path
    // segments; for /Raws/... trim trailing "!" segments.
    detailsUrl(mangaId) {
        const slug = this.safeDecode(mangaId).replace(/^\/+/, "");
        const segments = slug.split("/").filter((s) => s.length > 0);
        if (segments.length > 5 &&
            segments[0] === "Manga" &&
            segments[1].length === 1) {
            return `${BASE_URL}/${segments.slice(0, 5).join("/")}`;
        }
        if (segments.length > 2 && segments[0] === "Raws") {
            let i = segments.length - 1;
            while (i >= 2 && this.safeDecode(segments[i]).startsWith("!")) {
                i--;
            }
            return `${BASE_URL}/${segments.slice(0, i + 1).join("/")}`;
        }
        return `${BASE_URL}/${segments.join("/")}`;
    }
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    // Derives the display title from the path segments, skipping leading "!"
    // segments, matching the upstream mangaFromElement logic.
    titleFromPath(mangaId) {
        const slug = this.safeDecode(mangaId).replace(/^\/+/, "");
        const segments = slug
            .split("/")
            .filter((s) => s.length > 0)
            .map((s) => this.safeDecode(s));
        if (segments.length === 0)
            return "";
        let i = segments.length - 1;
        while (i > 0 && segments[i].startsWith("!")) {
            i--;
        }
        return segments[i];
    }
    parsePath(href) {
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
    // Mirrors upstream isArchiveUrl / ARCHIVE_EXTENSIONS: archive files are
    // individual downloads rather than browsable series and must be skipped.
    isArchiveUrl(url) {
        const path = this.safeDecode(url)
            .replace(/[?#].*$/, "")
            .toLowerCase();
        const exts = [
            ".zip",
            ".cbz",
            ".rar",
            ".cbr",
            ".7z",
            ".cb7",
            ".tar",
            ".cbt",
        ];
        return exts.some((ext) => path.endsWith(ext));
    }
    parseChapterNumber(name) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    // Parses either relative dates ("3 min ago", "2 hours ago") or the
    // "yyyy-MM-dd HH:mm" format used by the index table.
    parseDate(date) {
        const d = (date || "").trim();
        if (!d)
            return new Date(0);
        if (d.endsWith("ago")) {
            const parts = d.split(/\s+/);
            const amount = parseInt(parts[0], 10);
            if (isNaN(amount))
                return new Date(0);
            const unit = (parts[1] || "").toLowerCase();
            const now = Date.now();
            if (unit.startsWith("sec"))
                return new Date(now - amount * 1000);
            if (unit.startsWith("min"))
                return new Date(now - amount * 60_000);
            if (unit.startsWith("hour"))
                return new Date(now - amount * 3_600_000);
            return new Date(0);
        }
        const m = d.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (m) {
            const parsed = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10)));
            if (!isNaN(parsed.getTime()))
                return parsed;
        }
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
export const Madokami = new MadokamiExtension();
