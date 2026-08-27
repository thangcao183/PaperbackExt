import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { AtsumaruSettingsForm, getExcludedGenres } from "./settings";
const BASE_URL = "https://atsu.moe";
const TYPES = "Manga,Manwha,Manhua,OEL";
const PER_PAGE = 40;
// Upstream #18405 `BROWSE_LIMIT`: page size for the /api/home2/* carousels.
const BROWSE_LIMIT = 40;
const PROTOCOL_REGEX = /^https?:?\/\//;
// Genre list ported from the upstream Filters.kt (name -> Typesense genreId)
const GENRES = [
    { name: "Action", id: "39" },
    { name: "Adult", id: "46" },
    { name: "Adventure", id: "37" },
    { name: "Boys Love", id: "180" },
    { name: "Comedy", id: "6" },
    { name: "Drama", id: "31" },
    { name: "Fantasy", id: "36" },
    { name: "Girls Love", id: "4" },
    { name: "Hentai", id: "10" },
    { name: "Historical", id: "45" },
    { name: "Horror", id: "44" },
    { name: "Martial Arts", id: "29" },
    { name: "Mystery", id: "32" },
    { name: "Psychological", id: "18" },
    { name: "Romance", id: "9" },
    { name: "Sci-Fi", id: "1" },
    { name: "Slice of Life", id: "7" },
    { name: "Smut", id: "41" },
    { name: "Supernatural", id: "22" },
    { name: "Thriller", id: "19" },
    { name: "Tragedy", id: "5" },
];
class AtsumaruInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        const isImage = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(request.url);
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: isImage
                ? "image/avif,image/webp,*/*"
                : "*/*",
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
export class AtsumaruExtension {
    requestManager = new AtsumaruInterceptor("main");
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
        return new AtsumaruSettingsForm(GENRES);
    }
    // ----------------------------------------------------------------
    // Discover sections
    // ----------------------------------------------------------------
    async getDiscoverSections() {
        return [
            {
                id: "trending",
                title: "Trending",
                type: DiscoverSectionType.featured,
            },
            {
                id: "recentlyUpdated",
                title: "Recently Updated",
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
            const items = GENRES.map((genre) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genreId: genre.id },
                },
                name: genre.name,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        // Upstream #18405: the browse endpoints moved from `/api/infinite/*`
        // (page-indexed) to `/api/home2/*` (offset/limit) and now pass
        // `mediums=Comic` so light novels are excluded from the carousels.
        const endpoint = section.id === "trending" ? "popular" : "recentlyUpdated";
        const offset = (page - 1) * BROWSE_LIMIT;
        const timeframe = section.id === "trending" ? "&timeframe=daily" : "";
        const url = `${BASE_URL}/api/home2/${endpoint}?offset=${offset}&limit=${BROWSE_LIMIT}` +
            `&types=${TYPES}&mediums=Comic${timeframe}${this.excludedGenresQuery()}`;
        const json = (await this.fetchJson(url));
        const list = json.items ?? [];
        const items = list.map((manga) => ({
            type: section.id === "trending"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: this.toSafeId(manga.id),
            imageUrl: this.imageUrl(manga),
            title: manga.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: list.length >= BROWSE_LIMIT ? { page: page + 1 } : undefined,
        };
    }
    /**
     * Upstream #18502: genres blacklisted in the settings are excluded
     * server-side from the browse carousels.
     */
    excludedGenresQuery() {
        const ids = getExcludedGenres();
        if (ids.length === 0)
            return "";
        return `&excludedTags=${ids.join(",")}`;
    }
    // ----------------------------------------------------------------
    // Search (Typesense documents/search)
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const pageMeta = metadata;
        const page = pageMeta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const queryMeta = query.metadata;
        const genreId = queryMeta?.genreId;
        const params = [];
        params.push(`q=${encodeURIComponent(titleQuery || "*")}`);
        const filterBy = [];
        filterBy.push("hidden:!=true");
        if (genreId) {
            filterBy.push(`genreIds:=\`${genreId}\``);
        }
        // Safe mode (adult disabled, mirroring the default upstream preference).
        filterBy.push("isAdult:=false");
        filterBy.push("(mbContentRating:=[`Safe`,`Suggestive`,`Erotica`] || mbContentRating:!=*)");
        filterBy.push("views:>0");
        // Upstream #18405: exclude light novels from search results.
        filterBy.push("medium:!=[`Novel`]");
        // Upstream #18502: honour the settings-level genre blacklist.
        const excluded = getExcludedGenres();
        if (excluded.length > 0) {
            filterBy.push(`genreIds:!=[${excluded.map((id) => `\`${id}\``).join(",")}]`);
        }
        params.push(`filter_by=${encodeURIComponent(filterBy.join(" && "))}`);
        if (titleQuery.length > 0) {
            params.push(`query_by=${encodeURIComponent("title,englishTitle,otherNames,authors")}`);
            params.push(`query_by_weights=${encodeURIComponent("4,3,2,1")}`);
            params.push(`num_typos=${encodeURIComponent("4,3,2,1")}`);
        }
        params.push(`page=${page}`);
        params.push(`per_page=${PER_PAGE}`);
        const url = `${BASE_URL}/collections/manga/documents/search?${params.join("&")}`;
        const json = (await this.fetchJson(url));
        const hits = json.hits ?? [];
        const results = hits.map((hit) => ({
            mangaId: this.toSafeId(hit.document.id),
            imageUrl: this.imageUrl(hit.document),
            title: hit.document.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const found = json.found ?? 0;
        const perPage = json.request_params?.per_page ?? PER_PAGE;
        const currentPage = json.page ?? page;
        const hasNextPage = currentPage * perPage < found;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1, genreId } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const id = this.safeDecode(mangaId);
        const url = `${BASE_URL}/api/manga/page?id=${encodeURIComponent(id)}`;
        const json = (await this.fetchJson(url));
        const manga = json.mangaPage;
        if (!manga) {
            throw new Error("Content not found");
        }
        const synopsis = (manga.synopsis ?? "").trim();
        const otherNames = (manga.otherNames ?? []).filter((n) => n && n !== manga.title);
        const authors = this.parseAuthorsWithType(manga.authors);
        const author = authors
            .filter((a) => a.type === "Author" || a.type === undefined)
            .map((a) => a.name)
            .join(", ");
        const artist = authors
            .filter((a) => a.type === "Artist")
            .map((a) => a.name)
            .join(", ");
        const tagGroups = [];
        const genreNames = this.parseNames(manga.genres);
        const tagNames = this.parseNames(manga.tags);
        if (manga.type)
            genreNames.unshift(manga.type);
        if (genreNames.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genreNames.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        if (tagNames.length > 0) {
            tagGroups.push({
                id: "tags",
                title: "Tags",
                tags: tagNames.map((t) => ({
                    id: t.toLowerCase().replace(/\s+/g, "-"),
                    title: t,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: manga.title,
                secondaryTitles: otherNames,
                thumbnailUrl: this.imageUrl(manga),
                author: author || undefined,
                artist: artist || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(manga.status),
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
        const url = `${BASE_URL}/api/manga/allChapters?mangaId=${encodeURIComponent(id)}`;
        const json = (await this.fetchJson(url));
        // Resolve scanlator names from the details endpoint (best effort).
        let scanlatorMap = {};
        try {
            const detailsUrl = `${BASE_URL}/api/manga/page?id=${encodeURIComponent(id)}`;
            const detailsJson = (await this.fetchJson(detailsUrl));
            for (const s of detailsJson.mangaPage?.scanlators ?? []) {
                scanlatorMap[s.id] = s.name;
            }
        }
        catch {
            scanlatorMap = {};
        }
        const raw = json.chapters ?? [];
        const chapters = raw.map((c) => {
            const scanlator = c.scanlationMangaId
                ? scanlatorMap[c.scanlationMangaId]
                : undefined;
            const baseTitle = (c.title || "").trim();
            const title = scanlator ? `${baseTitle} [${scanlator}]` : baseTitle;
            return {
                chapterId: this.toSafeId(`${id}/${c.id}`),
                sourceManga,
                title: title || undefined,
                volume: 0,
                chapNum: typeof c.number === "number" ? c.number : 0,
                publishDate: this.parseDate(c.createdAt),
                langCode: "🇬🇧",
            };
        });
        chapters.sort((a, b) => b.chapNum - a.chapNum);
        return chapters;
    }
    async getChapterDetails(chapter) {
        const path = this.safeDecode(chapter.chapterId);
        const slash = path.indexOf("/");
        const slug = slash >= 0 ? path.slice(0, slash) : path;
        const name = slash >= 0 ? path.slice(slash + 1) : "";
        const url = `${BASE_URL}/api/read/chapter?mangaId=${encodeURIComponent(slug)}&chapterId=${encodeURIComponent(name)}`;
        const json = (await this.fetchJson(url));
        const pages = (json.readChapter?.pages ?? []).map((p) => this.pageImageUrl(p.image));
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
        return `${BASE_URL}/manga/${slug.replace(/^\/+/, "")}`;
    }
    imageUrl(manga) {
        let raw;
        const src = manga.poster ?? manga.image;
        if (typeof src === "string") {
            raw = src;
        }
        else if (src && typeof src === "object") {
            const inner = src["image"];
            if (typeof inner === "string")
                raw = inner;
        }
        if (!raw)
            return "";
        let cleaned = raw.replace(/^\//, "").replace(/^static\//, "");
        let full;
        if (cleaned.startsWith("http")) {
            full = cleaned;
        }
        else if (cleaned.startsWith("//")) {
            full = `https:${cleaned}`;
        }
        else {
            full = `${BASE_URL}/static/${cleaned}`;
        }
        return full.replace(PROTOCOL_REGEX, "https://");
    }
    pageImageUrl(image) {
        let full;
        if (image.startsWith("http")) {
            full = image;
        }
        else if (image.startsWith("//")) {
            full = `https:${image}`;
        }
        else {
            full = `${BASE_URL}/static/${image
                .replace(/^\//, "")
                .replace(/^static\//, "")}`;
        }
        return full.replace(PROTOCOL_REGEX, "https://");
    }
    parseNames(element) {
        if (!Array.isArray(element))
            return [];
        const out = [];
        for (const item of element) {
            if (typeof item === "string") {
                out.push(item);
            }
            else if (item && typeof item === "object") {
                const name = item["name"];
                if (typeof name === "string")
                    out.push(name);
            }
        }
        return out;
    }
    parseAuthorsWithType(element) {
        if (!Array.isArray(element))
            return [];
        const out = [];
        for (const item of element) {
            if (typeof item === "string") {
                out.push({ name: item });
            }
            else if (item && typeof item === "object") {
                const obj = item;
                const name = obj["name"];
                if (typeof name !== "string")
                    continue;
                const type = obj["type"];
                out.push({ name, type: typeof type === "string" ? type : undefined });
            }
        }
        return out;
    }
    parseDate(element) {
        if (typeof element === "number") {
            return new Date(element);
        }
        if (typeof element === "string") {
            const asNum = Number(element);
            if (!Number.isNaN(asNum) && element.trim() !== "") {
                return new Date(asNum);
            }
            const parsed = Date.parse(element.replace("T ", "T"));
            if (!Number.isNaN(parsed))
                return new Date(parsed);
        }
        return new Date(0);
    }
    parseStatus(status) {
        switch ((status || "").toLowerCase().trim()) {
            case "ongoing":
                return "Ongoing";
            case "completed":
                return "Completed";
            case "hiatus":
                return "Hiatus";
            case "canceled":
            case "cancelled":
                return "Cancelled";
            default:
                return "Unknown";
        }
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
    async fetchJson(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const text = Application.arrayBufferToUTF8String(data);
        return JSON.parse(text);
    }
}
export const Atsumaru = new AtsumaruExtension();
