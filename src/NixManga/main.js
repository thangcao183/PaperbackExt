import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://nixmanga.com";
const API_URL = "https://api.nixmanga.com";
const SITE_ID = "00000000-0000-0000-0000-000000000003";
const PER_PAGE = 24;
const SIGNER_JS_URL = `${API_URL}/_nix/signer.js`;
const SIGNER_JS_REGEX = /const z=\[(.*?)\],/;
class NixMangaInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "*/*",
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
export class NixMangaExtension {
    requestManager = new NixMangaInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
        bufferInterval: 1,
        ignoreImages: true,
    });
    // Cached values derived from signer.js (slot/token/k seed material).
    cachedSlot = "";
    cachedToken = "";
    cachedK = "";
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
        const sort = section.id === "popular" ? "popular" : "latest";
        const path = `/comics?page=${page}&per_page=${PER_PAGE}&sort=${sort}`;
        const dto = await this.fetchApi(path);
        const comics = dto.results ?? dto.comics ?? [];
        const items = comics.map((comic) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: this.toSafeId(comic.slug),
            imageUrl: comic.cover ?? "",
            title: comic.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: this.hasNextComicsPage(dto, page)
                ? { page: page + 1 }
                : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        let path;
        if (titleQuery.length > 0) {
            path = `/comics/search?q=${encodeURIComponent(titleQuery)}&page=${page}`;
        }
        else {
            path = `/comics?page=${page}&per_page=${PER_PAGE}&sort=latest`;
        }
        const dto = await this.fetchApi(path);
        const comics = dto.results ?? dto.comics ?? [];
        const results = comics.map((comic) => ({
            mangaId: this.toSafeId(comic.slug),
            imageUrl: comic.cover ?? "",
            title: comic.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items: results,
            metadata: this.hasNextComicsPage(dto, page)
                ? { page: page + 1 }
                : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const dto = await this.fetchApi(`/comics/slug/${slug}`);
        const genres = (dto.genres ?? [])
            .map((g) => (g.name ?? "").trim())
            .filter((name) => name.length > 0);
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
                primaryTitle: dto.title,
                secondaryTitles: [],
                thumbnailUrl: dto.cover ?? "",
                synopsis: dto.synopsis ?? "",
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(dto.status),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const chapters = [];
        const seen = new Set();
        let page = 1;
        for (;;) {
            const path = `/comics/slug/${slug}/chapters?page=${page}&per_page=100&sort=newest`;
            const dto = await this.fetchApi(path);
            const list = dto.chapters ?? [];
            for (const ch of list) {
                const chapterId = this.toSafeId(`/read/${slug}/${ch.slug}#${ch.id}`);
                if (seen.has(chapterId))
                    continue;
                seen.add(chapterId);
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: this.buildChapterName(ch),
                    volume: 0,
                    chapNum: ch.number ?? 0,
                    publishDate: this.parseDate(ch.published_at),
                    langCode: "🇬🇧",
                });
            }
            const totalPages = dto.total_pages ?? 1;
            const current = dto.page ?? page;
            if (current >= totalPages || list.length === 0)
                break;
            page++;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const id = decoded.substring(decoded.lastIndexOf("#") + 1);
        const dto = await this.fetchApi(`/chapters/${id}?skip_view=true`);
        const pages = (dto.pages ?? [])
            .map((p) => this.absoluteUrl(p.image_url))
            .filter((url) => url.length > 0);
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
    // API request signing + fetch
    // ----------------------------------------------------------------
    async fetchApi(path) {
        const endpoint = `/api/v1${path.split("?")[0]}`;
        let headers = await this.getApiHeaders(endpoint, false);
        const url = `${API_URL}/api/v1${path}`;
        let [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
            headers,
        });
        // On 401 the token has rotated; refresh signer values and retry once.
        if (response.status === 401) {
            headers = await this.getApiHeaders(endpoint, true);
            [response, data] = await Application.scheduleRequest({
                url,
                method: "GET",
                headers,
            });
        }
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const text = Application.arrayBufferToUTF8String(data);
        return JSON.parse(text);
    }
    async getApiHeaders(endpoint, refresh) {
        if (refresh || this.cachedSlot.length === 0) {
            await this.refreshAuthValues();
        }
        const signature = await this.computeSignature(endpoint);
        return {
            "x-web-token": this.cachedToken,
            "x-web-signature": signature,
            "x-web-slot": this.cachedSlot,
            "x-site-id": SITE_ID,
            accept: "*/*",
            origin: BASE_URL,
            referer: `${BASE_URL}/`,
            "sec-fetch-site": "same-site",
        };
    }
    async refreshAuthValues() {
        const [, data] = await Application.scheduleRequest({
            url: SIGNER_JS_URL,
            method: "GET",
            headers: {
                accept: "*/*",
                origin: BASE_URL,
                referer: `${BASE_URL}/`,
            },
        });
        const body = Application.arrayBufferToUTF8String(data);
        const match = SIGNER_JS_REGEX.exec(body);
        if (!match) {
            throw new Error("Failed to parse signer.js");
        }
        const zArr = match[1]
            .split(",")
            .map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
        const reverse = (s) => s.split("").reverse().join("");
        const rJoin = (arr) => arr.map((s) => reverse(s)).join("");
        this.cachedSlot = reverse(zArr[0]);
        this.cachedToken = rJoin(zArr.slice(4));
        this.cachedK = rJoin(zArr.slice(1, 4));
    }
    async computeSignature(endpoint) {
        const payload = `GET|${endpoint}|${SITE_ID}|${this.cachedSlot}|${this.cachedToken}|${this.cachedK}`;
        const subtle = globalThis.crypto
            .subtle;
        const hash = await subtle.digest("SHA-256", this.utf8Buffer(payload));
        return this.base64Url(new Uint8Array(hash));
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    buildChapterName(ch) {
        let name;
        if (ch.number !== null && ch.number !== undefined) {
            name = `Chapter ${this.formatNumber(ch.number)}`;
        }
        else {
            name = "Chapter";
        }
        if (ch.title && ch.title.length > 0) {
            name += ` - ${ch.title}`;
        }
        return name.trim();
    }
    formatNumber(num) {
        return String(num).replace(/\.0$/, "");
    }
    hasNextComicsPage(dto, page) {
        const totalPages = dto.total_pages ?? 1;
        const total = dto.total ?? 0;
        const current = dto.page ?? page;
        return current < totalPages || page * PER_PAGE < total;
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
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
    parseStatus(status) {
        switch ((status || "").toLowerCase()) {
            case "ongoing":
                return "Ongoing";
            case "completed":
                return "Completed";
            case "hiatus":
                return "Hiatus";
            case "cancelled":
                return "Cancelled";
            default:
                return "Unknown";
        }
    }
    parseDate(dateStr) {
        if (!dateStr)
            return new Date(0);
        const ms = Date.parse(dateStr);
        return Number.isNaN(ms) ? new Date(0) : new Date(ms);
    }
    utf8Buffer(str) {
        const out = [];
        for (let i = 0; i < str.length; i++) {
            let code = str.charCodeAt(i);
            if (code < 0x80) {
                out.push(code);
            }
            else if (code < 0x800) {
                out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            }
            else if (code < 0xd800 || code >= 0xe000) {
                out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
            else {
                // surrogate pair
                i++;
                code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
        }
        const buffer = new ArrayBuffer(out.length);
        new Uint8Array(buffer).set(out);
        return buffer;
    }
    base64Url(bytes) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let result = "";
        let i = 0;
        for (; i + 2 < bytes.length; i += 3) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            result +=
                chars[(n >> 18) & 63] +
                    chars[(n >> 12) & 63] +
                    chars[(n >> 6) & 63] +
                    chars[n & 63];
        }
        const rem = bytes.length - i;
        if (rem === 1) {
            const n = bytes[i] << 16;
            result += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
        }
        else if (rem === 2) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
            result +=
                chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63];
        }
        return result;
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
}
export const NixManga = new NixMangaExtension();
