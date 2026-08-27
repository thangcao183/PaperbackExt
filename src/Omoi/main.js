import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.omoi.com";
const API_URL = "https://production.api.azuki.co";
const ORGANIZATION_KEY = "199e5a19-a236-49f5-81f4-43d4a541748a";
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
class OmoiInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        const isApi = request.url.startsWith(API_URL);
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
            ...(isApi ? { "azuki-organization-key": ORGANIZATION_KEY } : {}),
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
        // DRM-protected page images are XOR-encrypted: every byte is XORed with
        // 174. The marker is the `drm` query parameter on the image URL (the same
        // signal the upstream okhttp ImageInterceptor keys off of). This is a pure
        // byte transform, so we apply it directly to the Uint8Array here without
        // needing a webview.
        if (hasDrmFlag(request.url)) {
            try {
                return xorDecrypt(data, 174);
            }
            catch {
                // On any failure, return the original bytes so the reader at least
                // shows *something* rather than nothing.
                return data;
            }
        }
        return data;
    }
}
// --------------------------------------------------------------------
// Page-image decryption (module-level helpers)
// --------------------------------------------------------------------
// Returns true when the request URL carries a `drm` query parameter, which
// marks an XOR-encrypted page image served by the Azuki/Omoi API.
function hasDrmFlag(url) {
    const queryStart = url.indexOf("?");
    if (queryStart < 0)
        return false;
    const query = url.slice(queryStart + 1).split("#")[0];
    for (const part of query.split("&")) {
        const name = part.split("=")[0];
        if (name === "drm")
            return true;
    }
    return false;
}
// XOR every byte of the buffer with `key`. Faithful port of the upstream
// loop: `bytes[i] = bytes[i] xor 174`.
function xorDecrypt(data, key) {
    const bytes = new Uint8Array(data);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        out[i] = bytes[i] ^ key;
    }
    return out.buffer;
}
export class OmoiExtension {
    requestManager = new OmoiInterceptor("main");
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
                id: "recent_series",
                title: "Recent Series",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "popular" : "recent_series";
        const url = `${BASE_URL}/discover?sort=${sort}&page=${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const { items: parsed, hasNextPage } = this.parseSeriesList($);
        const items = parsed.map((entry) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            metadata: undefined,
        }));
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
        const params = [`page=${page}`];
        if (titleQuery)
            params.push(`q=${encodeURIComponent(titleQuery)}`);
        const url = `${BASE_URL}/discover?${params.join("&")}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const { items: parsed, hasNextPage } = this.parseSeriesList($);
        const results = parsed.map((entry) => ({
            mangaId: entry.mangaId,
            imageUrl: entry.imageUrl,
            title: entry.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    parseSeriesList($) {
        const items = [];
        const seen = new Set();
        $("ol.o-series-card-list li").each((_, element) => {
            const el = $(element);
            const link = el.find("a.a-card-link").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const gaItemId = link.attr("data-ga-item-id") || "";
            const uuid = gaItemId.includes("series-")
                ? gaItemId.substring(gaItemId.indexOf("series-") + "series-".length)
                : "";
            const slug = this.lastPathSegment(href);
            if (!slug)
                return;
            const mangaId = this.toSafeId(`${slug}#${uuid}`);
            if (seen.has(mangaId))
                return;
            seen.add(mangaId);
            const title = link.text().trim();
            const imageUrl = this.imageFromElement(el.find("img").first());
            if (!title)
                return;
            items.push({ mangaId, imageUrl, title });
        });
        const hasNextPage = $("a[rel=next]").length > 0;
        return { items, hasNextPage };
    }
    // ----------------------------------------------------------------
    // Manga details (JSON API)
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const { slug } = this.splitMangaId(mangaId);
        const url = `${API_URL}/manga/slug/${slug}/v0`;
        const details = await this.fetchJson({ url, method: "GET" });
        const title = details.name || slug;
        const thumbnailUrl = this.bestWebp(details.image?.webp ?? undefined);
        const author = (details.creators ?? [])
            .map((c) => c.name)
            .filter((n) => !!n)
            .join(", ");
        let synopsis = details.short_description || "";
        if (details.credits)
            synopsis += `\n\n${details.credits}`;
        const altTitles = (details.alt_titles ?? [])
            .map((t) => t.name)
            .filter((n) => !!n);
        if (altTitles.length > 0) {
            synopsis += `\n\nAlternative Titles:\n${altTitles.join("\n")}`;
        }
        if (details.release_schedule) {
            synopsis += `\n\n${details.release_schedule}`;
        }
        const tags = (details.tags ?? []).filter((t) => !!t);
        const tagGroups = [];
        if (tags.length > 0) {
            tagGroups.push({
                id: "tags",
                title: "Tags",
                tags: tags.map((t) => ({
                    id: t.toLowerCase().replace(/\s+/g, "-"),
                    title: t,
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
                artist: author || undefined,
                synopsis: synopsis.trim(),
                contentRating: ContentRating.MATURE,
                status: details.is_complete === true ? "Completed" : "Ongoing",
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters (JSON API)
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const { slug, uuid } = this.splitMangaId(sourceManga.mangaId);
        const url = `${API_URL}/mangas/${uuid}/chapters/v4` +
            `?order=ascending&count=1000`;
        const result = await this.fetchJson({
            url,
            method: "GET",
        });
        const now = Date.now();
        const chapters = [];
        for (const entry of result.chapters ?? []) {
            const freePublished = this.parseDate(entry.free_published_date);
            const freeUnpublished = this.parseDate(entry.free_unpublished_date);
            const isFree = freePublished !== undefined &&
                freePublished.getTime() <= now &&
                (freeUnpublished === undefined || freeUnpublished.getTime() > now);
            const isLocked = !isFree;
            const label = `Chapter ${entry.label}`;
            let fullTitle = entry.title ? `${label} - ${entry.title}` : label;
            if (entry.is_upcoming === true)
                fullTitle = `${fullTitle} - [Upcoming]`;
            const name = isLocked ? `🔒 ${fullTitle}` : fullTitle;
            const publishDate = this.parseDate(entry.release_date) ?? new Date(0);
            chapters.push({
                chapterId: this.toSafeId(`${entry.uuid}#${slug}`),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(entry.label),
                publishDate,
                langCode: "🇬🇧",
            });
        }
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const { uuid } = this.splitChapterId(chapter.chapterId);
        const url = `${API_URL}/chapters/${uuid}/pages/v1`;
        const result = await this.fetchJson({
            url,
            method: "GET",
        });
        const pages = [];
        for (const page of result.data?.pages ?? []) {
            const best = this.bestWebpEntry(page.image?.webp ?? undefined);
            if (!best)
                continue;
            // Upscale to highest possible resolution as upstream does.
            const highResUrl = best.url.replace(/\/\d+_/, "/2400_");
            pages.push(`${highResUrl}?drm=1`);
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
        const { slug } = this.splitMangaId(mangaId);
        return `${BASE_URL}/series/${slug}`;
    }
    splitMangaId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const hashIndex = decoded.indexOf("#");
        if (hashIndex < 0)
            return { slug: decoded, uuid: "" };
        return {
            slug: decoded.substring(0, hashIndex),
            uuid: decoded.substring(hashIndex + 1),
        };
    }
    splitChapterId(chapterId) {
        const decoded = this.safeDecode(chapterId);
        const hashIndex = decoded.indexOf("#");
        if (hashIndex < 0)
            return { uuid: decoded, slug: "" };
        return {
            uuid: decoded.substring(0, hashIndex),
            slug: decoded.substring(hashIndex + 1),
        };
    }
    lastPathSegment(href) {
        const cleaned = this.safeDecode(href).replace(/[?#].*$/, "").replace(/\/+$/, "");
        const withoutDomain = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        const segments = withoutDomain.split("/").filter((s) => s.length > 0);
        return segments.length > 0 ? segments[segments.length - 1] : "";
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
    parseChapterNumber(label) {
        const m = (label || "").match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    parseDate(value) {
        if (!value)
            return undefined;
        const time = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
        if (Number.isNaN(time))
            return undefined;
        return new Date(time);
    }
    bestWebp(webp) {
        const best = this.bestWebpEntry(webp);
        if (!best)
            return "";
        return best.url.replace(/\/\d+_/, "/2400_");
    }
    bestWebpEntry(webp) {
        if (!webp || webp.length === 0)
            return undefined;
        let best = webp[0];
        for (const candidate of webp) {
            if (candidate.width > best.width)
                best = candidate;
        }
        return best;
    }
    imageFromElement(img) {
        const src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            img.attr("src") ||
            "";
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        if (response.status === 401 || response.status === 403) {
            throw new Error("Log in via WebView and purchase this title to read this content.");
        }
        const text = Application.arrayBufferToUTF8String(data);
        const parsed = JSON.parse(text);
        if (!isRecord(parsed)) {
            throw new Error("Unexpected API response");
        }
        return parsed;
    }
}
export const Omoi = new OmoiExtension();
