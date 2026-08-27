import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { removeWatermark } from "./watermark";
const BASE_URL = "https://doujin.io";
const LATEST_LIMIT = 20;
// Upstream `sortOptions` (Filters.kt). The API takes `sort` + `sort_dir`, so
// each Paperback sorting option encodes both halves.
const SORT_OPTIONS = [
    { id: "published_at:desc", label: "Date (newest)", sort: "published_at", dir: "desc" },
    { id: "published_at:asc", label: "Date (oldest)", sort: "published_at", dir: "asc" },
    { id: "hidden_title:asc", label: "Alphabetical (A-Z)", sort: "hidden_title", dir: "asc" },
    { id: "hidden_title:desc", label: "Alphabetical (Z-A)", sort: "hidden_title", dir: "desc" },
];
// Tag list ported verbatim from the upstream DoujinioHelper.kt
const TAGS = [
    { id: 22, name: "Aggressive Sex" },
    { id: 23, name: "Anal" },
    { id: 104, name: "BBM" },
    { id: 105, name: "BSS" },
    { id: 62, name: "Big Breasts" },
    { id: 26, name: "Blowjob" },
    { id: 27, name: "Bondage" },
    { id: 29, name: "Cheating" },
    { id: 32, name: "Creampie" },
    { id: 33, name: "Crossdressing" },
    { id: 34, name: "Cunnilingus" },
    { id: 35, name: "Dark Skin" },
    { id: 36, name: "Defloration" },
    { id: 38, name: "Demon Girl" },
    { id: 51, name: "Dickgirl" },
    { id: 112, name: "Doll Joints" },
    { id: 41, name: "Elf" },
    { id: 106, name: "Exhibitionism" },
    { id: 107, name: "Family" },
    { id: 44, name: "Femdom" },
    { id: 46, name: "Footjob" },
    { id: 49, name: "Full Color" },
    { id: 50, name: "Furry" },
    { id: 53, name: "Gender Bender" },
    { id: 54, name: "Group" },
    { id: 55, name: "Gyaru" },
    { id: 56, name: "Gym Uniform" },
    { id: 114, name: "Kemonomimi" },
    { id: 61, name: "Lactation" },
    { id: 9, name: "Maid Uniform" },
    { id: 65, name: "Mind Control" },
    { id: 108, name: "Mindbreak" },
    { id: 109, name: "Monster Girl" },
    { id: 69, name: "Muscle" },
    { id: 71, name: "Netorare" },
    { id: 73, name: "Ninja Outfit" },
    { id: 74, name: "Non-H" },
    { id: 75, name: "Nun Outfit" },
    { id: 76, name: "Nurse Outfit" },
    { id: 78, name: "Old Man" },
    { id: 82, name: "Pay To Play" },
    { id: 80, name: "Petite" },
    { id: 81, name: "Pregnant" },
    { id: 83, name: "Rimjob" },
    { id: 84, name: "School Uniform" },
    { id: 110, name: "Small Breasts" },
    { id: 63, name: "Solo Action" },
    { id: 90, name: "Swimsuit" },
    { id: 91, name: "Tanlines" },
    { id: 92, name: "Tentacles" },
    { id: 93, name: "Titjob" },
    { id: 94, name: "Toys" },
    { id: 95, name: "Urination" },
    { id: 99, name: "Yaoi" },
];
class DoujinIoJ18Interceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.5",
        };
        // Upstream `cleanHeaders`: the search/latest POST endpoints answer 419 when
        // Referer or Origin is present.
        if (request.method === "POST") {
            delete request.headers["referer"];
        }
        else {
            request.headers["origin"] = BASE_URL;
        }
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
        // Upstream #18164: page images hide a clean patch that must be composited
        // over the watermark. `getChapterDetails` appends the chapter's AES key to
        // each page URL as a `#chm=...` fragment (fragments are never transmitted
        // over HTTP, so this is invisible to the server — same approach as Mangago).
        const keyBytes = parseWatermarkKey(request.url);
        if (keyBytes && response.status >= 200 && response.status < 300) {
            try {
                return await removeWatermark(data, keyBytes);
            }
            catch {
                // Never throw from interceptResponse — show the watermarked page
                // rather than nothing.
                return data;
            }
        }
        return data;
    }
}
/**
 * Recover the `chmkeys` bytes that `getChapterDetails` appended to a page URL
 * as `#chm=<comma-separated bytes>`. Returns undefined when the page is not
 * watermark-protected (or the chapter's key endpoint was unavailable).
 */
function parseWatermarkKey(url) {
    const fragment = url.split("#")[1];
    if (!fragment)
        return undefined;
    const match = fragment.match(/(?:^|&)chm=([0-9,]+)/);
    if (!match)
        return undefined;
    const parts = match[1].split(",").filter((p) => p.length > 0);
    if (parts.length === 0)
        return undefined;
    const bytes = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
        bytes[i] = parseInt(parts[i], 10) & 0xff;
    }
    return bytes;
}
export class DoujinIoJ18Extension {
    requestManager = new DoujinIoJ18Interceptor("main");
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
                title: "Newest",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "tags",
                title: "Tags",
                type: DiscoverSectionType.genres,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id === "tags") {
            const items = TAGS.map((tag) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { tagId: tag.id },
                },
                name: tag.name,
                metadata: { tagId: tag.id },
            }));
            return { items, metadata: undefined };
        }
        if (section.id === "popular") {
            const list = await this.fetchMangaList({
                url: `${BASE_URL}/api/mangas/popular`,
                method: "GET",
            });
            const items = list.map((m) => ({
                type: "featuredCarouselItem",
                mangaId: this.toSafeId(String(m.optimus_id)),
                imageUrl: this.absoluteUrl(m.thumb),
                title: m.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        // latest (paged, POST)
        const meta = metadata;
        const page = meta?.page ?? 1;
        const list = await this.fetchMangaList({
            url: `${BASE_URL}/api/mangas/newest`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                limit: LATEST_LIMIT,
                offset: (page - 1) * LATEST_LIMIT,
            }),
        });
        const items = list.map((m) => ({
            type: "simpleCarouselItem",
            mangaId: this.toSafeId(String(m.optimus_id)),
            imageUrl: this.absoluteUrl(m.thumb),
            title: m.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: list.length >= LATEST_LIMIT ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSortingOptions() {
        return SORT_OPTIONS.map(({ id, label }) => ({ id, label }));
    }
    async getSearchResults(query, metadata, sortingOption) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const queryMeta = query.metadata;
        const tags = [];
        if (typeof queryMeta?.tagId === "number") {
            tags.push(queryMeta.tagId);
        }
        // Upstream #18164 added `sort` / `sort_dir` to the search payload.
        const chosen = SORT_OPTIONS.find((o) => o.id === sortingOption?.id) ?? SORT_OPTIONS[0];
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/api/mangas/search`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                keyword: titleQuery,
                page,
                tags,
                sort: chosen.sort,
                sort_dir: chosen.dir,
            }),
        });
        if (response.status === 404) {
            return { items: [], metadata: undefined };
        }
        const parsed = this.parseWrapped(data);
        const items = (parsed?.data ?? []).map((m) => ({
            mangaId: this.toSafeId(String(m.optimus_id)),
            imageUrl: this.absoluteUrl(m.thumb),
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = parsed?.to != null && parsed.to < (parsed.total ?? 0);
        return {
            items,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const id = this.safeDecode(mangaId);
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/api/mangas/${id}`,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const manga = this.parseWrapped(data);
        if (!manga) {
            throw new Error("Content not found");
        }
        const tagGroups = [];
        const mangaTags = manga.tags ?? [];
        if (mangaTags.length > 0) {
            tagGroups.push({
                id: "tags",
                title: "Tags",
                tags: mangaTags.map((t) => ({
                    id: String(t.id),
                    title: t.name,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: manga.title,
                secondaryTitles: [],
                thumbnailUrl: this.absoluteUrl(manga.thumb),
                artist: manga.creator_name,
                synopsis: manga.description,
                contentRating: ContentRating.MATURE,
                status: "Completed",
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const id = this.safeDecode(sourceManga.mangaId);
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/api/chapters?manga_id=${id}`,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const list = this.parseWrapped(data) ?? [];
        // Upstream reverses the API order so newest is first.
        const reversed = [...list].reverse();
        return reversed.map((c) => ({
            chapterId: this.toSafeId(`manga/${c.manga_optimus_id}/chapter/${c.optimus_id}`),
            sourceManga,
            // Upstream #18164 prefixes an invisible separator because a chapter name
            // identical to the manga title gets trimmed away to an empty label.
            title: `\u2063${c.chapter_name}`,
            volume: 0,
            chapNum: c.chapter_order + 1,
            publishDate: this.parseDate(c.published_at),
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const path = this.safeDecode(chapter.chapterId);
        // path = "manga/{mangaId}/chapter/{chapterId}"
        const segments = path.split("/");
        const mangaId = segments[1] ?? "";
        const chapterId = segments[segments.length - 1] ?? "";
        const [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/api/mangas/${mangaId}/${chapterId}/manifest`,
            method: "GET",
            headers: {
                referer: `${BASE_URL}/manga/${mangaId}/chapter/${chapterId}`,
            },
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const contentType = (response.headers?.["content-type"] ||
            response.headers?.["Content-Type"] ||
            "").toLowerCase();
        if (contentType.includes("text/html")) {
            throw new Error("You need to login first through the WebView to read the chapter.");
        }
        // Upstream #18164: `/chm` returns the AES key used to decrypt the clean
        // patch embedded in each page image. It is best-effort — when it fails the
        // pages simply stay watermarked instead of failing to load.
        const fragment = await this.fetchWatermarkFragment(mangaId, chapterId);
        const manifest = this.parseJson(data);
        const pages = [];
        if (manifest) {
            for (const page of manifest.readingOrder ?? []) {
                if (page.type && page.type.startsWith("image")) {
                    pages.push(this.absoluteUrl(page.href) + fragment);
                }
            }
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    /**
     * Fetch the chapter's watermark-removal key and encode it as a URL fragment
     * (`#chm=1,2,3,...`) for the response interceptor to pick up. Returns an
     * empty string when the key is unavailable.
     */
    async fetchWatermarkFragment(mangaId, chapterId) {
        try {
            const [response, data] = await Application.scheduleRequest({
                url: `${BASE_URL}/api/mangas/${mangaId}/${chapterId}/chm`,
                method: "GET",
                headers: {
                    referer: `${BASE_URL}/manga/${mangaId}/chapter/${chapterId}`,
                },
            });
            if (response.status < 200 || response.status >= 300)
                return "";
            const keys = this.parseJson(data);
            const chmkeys = keys?.chmkeys;
            if (!chmkeys || chmkeys.length === 0)
                return "";
            return `#chm=${chmkeys.map((k) => k & 0xff).join(",")}`;
        }
        catch {
            return "";
        }
    }
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(mangaId);
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    async fetchMangaList(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            return [];
        }
        return this.parseWrapped(data) ?? [];
    }
    // The API wraps payloads in { data: T } (PageResponse<T>).
    parseWrapped(data) {
        const parsed = this.parseJson(data);
        return parsed?.data;
    }
    parseJson(data) {
        try {
            return JSON.parse(Application.arrayBufferToUTF8String(data));
        }
        catch {
            return undefined;
        }
    }
    parseDate(dateStr) {
        if (!dateStr)
            return new Date(0);
        // Upstream format: "yyyy-MM-dd HH:mm:ss"
        const iso = dateStr.trim().replace(" ", "T");
        const t = Date.parse(iso);
        if (!isNaN(t))
            return new Date(t);
        const t2 = Date.parse(dateStr);
        return isNaN(t2) ? new Date(0) : new Date(t2);
    }
    mangaUrl(mangaId) {
        const id = this.safeDecode(mangaId);
        if (id.startsWith("http"))
            return id;
        return `${BASE_URL}/manga/${id.replace(/^\/+/, "")}`;
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
    // Cloudflare
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
export const DoujinIoJ18 = new DoujinIoJ18Extension();
