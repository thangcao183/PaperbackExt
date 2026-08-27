import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://webdexscans.com";
const SUPABASE_URL = "https://nrqghtbdrdnoywxjkgkf.supabase.co/rest/v1";
const SUPABASE_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycWdodGJkcmRub3l3eGprZ2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Njg4NDEsImV4cCI6MjA5MjQ0NDg0MX0.Gnrn33_LMxFA9m_OdCpybBZ-Cjcc5rdsJlD8Y9eOICg";
const PAGE_SIZE = 24;
const GENRES = [
    { title: "Action", slug: "action" },
    { title: "Adventure", slug: "adventure" },
    { title: "Comedy", slug: "comedy" },
    { title: "Drama", slug: "drama" },
    { title: "Fantasy", slug: "fantasy" },
    { title: "Isekai", slug: "isekai" },
    { title: "Martial Arts", slug: "martial-arts" },
    { title: "Mystery", slug: "mystery" },
    { title: "Romance", slug: "romance" },
    { title: "Sci-Fi", slug: "sci-fi" },
    { title: "Seinen", slug: "seinen" },
    { title: "Shounen", slug: "shounen" },
    { title: "Slice of Life", slug: "slice-of-life" },
    { title: "Supernatural", slug: "supernatural" },
];
class WebdexScansInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        const isApi = request.url.startsWith(SUPABASE_URL);
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: isApi
                ? "application/json"
                : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
        };
        if (isApi) {
            request.headers = {
                ...request.headers,
                apikey: SUPABASE_API_KEY,
                authorization: `Bearer ${SUPABASE_API_KEY}`,
            };
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
        return data;
    }
}
export class WebdexScansExtension {
    requestManager = new WebdexScansInterceptor("main");
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
                title: "Latest Updates",
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
            const items = GENRES.map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre: g.slug },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const order = section.id === "popular" ? "view_count.desc" : "updated_at.desc";
        const dtos = await this.fetchSeriesList({ page, order });
        const items = dtos.map((dto) => {
            const parsed = this.seriesToResult(dto);
            return {
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            };
        });
        return {
            items,
            metadata: dtos.length === PAGE_SIZE ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const queryMeta = query.metadata;
        const genre = meta?.genre ?? queryMeta?.genre;
        const dtos = await this.fetchSeriesList({
            page,
            order: "updated_at.desc",
            title: titleQuery,
            genre,
        });
        const items = dtos.map((dto) => {
            const parsed = this.seriesToResult(dto);
            return {
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            };
        });
        const nextMeta = dtos.length === PAGE_SIZE
            ? { page: page + 1, ...(genre ? { genre } : {}) }
            : undefined;
        return { items, metadata: nextMeta };
    }
    async fetchSeriesList(opts) {
        const offset = (opts.page - 1) * PAGE_SIZE;
        const params = [];
        if (opts.genre) {
            params.push(`select=${encodeURIComponent("title,slug,cover_url,genres!inner(slug)")}`);
            params.push(`genres.slug=${encodeURIComponent(`eq.${opts.genre}`)}`);
        }
        else {
            params.push(`select=${encodeURIComponent("title,slug,cover_url")}`);
        }
        if (opts.title) {
            params.push(`title=${encodeURIComponent(`ilike.%${opts.title}%`)}`);
        }
        params.push(`order=${encodeURIComponent(opts.order)}`);
        params.push(`offset=${offset}`);
        params.push(`limit=${PAGE_SIZE}`);
        const url = `${SUPABASE_URL}/series?${params.join("&")}`;
        const data = await this.fetchJson(url);
        if (!Array.isArray(data))
            return [];
        return data;
    }
    seriesToResult(dto) {
        const slug = dto.slug || "";
        const mangaId = this.toSafeId(`series/${slug}`);
        return {
            mangaId,
            imageUrl: this.absoluteUrl(dto.cover_url || ""),
            title: dto.title || slug,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const flight = await this.fetchFlight(url);
        const series = this.findObjectWithKeys(flight, [
            "slug",
            "title",
        ]);
        const genres = this.findArrayOfObjectsWithKeys(flight, [
            "name",
        ]);
        const title = series?.title || this.slugFromId(mangaId);
        const thumbnailUrl = this.absoluteUrl(series?.cover_url || "");
        const tagGroups = [];
        if (genres && genres.length > 0) {
            const tags = genres
                .map((g) => g.name || "")
                .filter((n) => n.length > 0)
                .map((n) => ({
                id: n.toLowerCase().replace(/\s+/g, "-"),
                title: n,
            }));
            if (tags.length > 0) {
                tagGroups.push({ id: "genres", title: "Genres", tags });
            }
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: series?.author || undefined,
                artist: series?.artist || undefined,
                synopsis: series?.description || "",
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(series?.status),
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
        const flight = await this.fetchFlight(url);
        const seriesSlug = this.slugFromId(sourceManga.mangaId);
        const chapterDtos = this.findArrayOfObjectsWithKeys(flight, ["slug"]);
        const chapters = [];
        const seen = new Set();
        const list = chapterDtos ?? [];
        list.forEach((dto) => {
            const slug = dto.slug;
            if (!slug)
                return;
            const chapterId = this.toSafeId(`series/${seriesSlug}/${slug}`);
            if (seen.has(chapterId))
                return;
            seen.add(chapterId);
            const num = typeof dto.chapter_number === "number" ? dto.chapter_number : undefined;
            const baseName = dto.title && dto.title.trim().length > 0
                ? dto.title.trim()
                : num !== undefined
                    ? `Chapter ${String(num)}`
                    : "Chapter";
            const name = dto.is_premium ? `🔒 ${baseName}` : baseName;
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: num ?? this.parseChapterNumber(baseName),
                publishDate: this.parseDate(dto.created_at),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const flight = await this.fetchFlight(url);
        const pageDtos = this.findArrayOfObjectsWithKeys(flight, [
            "image_url",
        ]);
        const pages = [];
        for (const dto of pageDtos ?? []) {
            const src = dto.image_url || "";
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
    // Next.js flight data extraction
    // ----------------------------------------------------------------
    // Fetches the page HTML and returns parsed JSON elements extracted from the
    // Next.js `self.__next_f.push([...])` RSC flight chunks. Mirrors the upstream
    // extractNextJs logic (without full RSC ref resolution, which the data objects
    // we need do not require).
    async fetchFlight(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const html = Application.arrayBufferToUTF8String(data);
        return this.extractFlightPayloads(html);
    }
    extractFlightPayloads(html) {
        const results = [];
        const marker = "self.__next_f.push(";
        let searchFrom = 0;
        while (true) {
            const idx = html.indexOf(marker, searchFrom);
            if (idx === -1)
                break;
            const argStart = idx + marker.length;
            // The argument is a JSON array literal; bracket-match it precisely.
            const [arr, end] = this.parseJsonAt(html, argStart);
            searchFrom = end > argStart ? end : argStart + 1;
            if (!Array.isArray(arr) || arr.length < 2)
                continue;
            const body = arr[1];
            if (typeof body !== "string")
                continue;
            for (const element of this.parseRscChunks(body)) {
                results.push(element);
            }
        }
        return results;
    }
    // Walks the RSC chunk body extracting JSON values that follow a `<hex>:` header.
    parseRscChunks(body) {
        const out = [];
        let pos = 0;
        while (pos < body.length) {
            const colonIdx = body.indexOf(":", pos);
            if (colonIdx === -1)
                break;
            const id = body.substring(pos, colonIdx);
            if (id.length === 0 || !/^[0-9a-fA-F]+$/.test(id)) {
                pos++;
                continue;
            }
            pos = colonIdx + 1;
            if (pos >= body.length)
                break;
            // Skip a leading non-JSON marker char (e.g. T, I, H...) until we hit a brace/bracket.
            while (pos < body.length && body[pos] !== "{" && body[pos] !== "[") {
                // Stop if we run into the next chunk header digit pattern; just advance.
                if (body[pos] === "\n") {
                    pos++;
                    break;
                }
                pos++;
            }
            if (pos >= body.length)
                break;
            if (body[pos] !== "{" && body[pos] !== "[")
                continue;
            const [element, end] = this.parseJsonAt(body, pos);
            if (element !== undefined)
                out.push(element);
            pos = end > pos ? end : pos + 1;
        }
        return out;
    }
    parseJsonAt(body, start) {
        let depth = 0;
        let inString = false;
        let escape = false;
        let i = start;
        while (i < body.length) {
            const c = body[i++];
            if (escape) {
                escape = false;
                continue;
            }
            if (c === "\\" && inString) {
                escape = true;
                continue;
            }
            if (c === '"') {
                inString = !inString;
                continue;
            }
            if (inString)
                continue;
            if (c === "{" || c === "[")
                depth++;
            else if (c === "}" || c === "]") {
                depth--;
                if (depth === 0) {
                    try {
                        return [JSON.parse(body.substring(start, i)), i];
                    }
                    catch {
                        return [undefined, i];
                    }
                }
            }
        }
        return [undefined, i];
    }
    // Recursively searches the parsed payloads for the first object containing all keys.
    findObjectWithKeys(roots, keys) {
        for (const root of roots) {
            const found = this.searchObject(root, keys);
            if (found)
                return found;
        }
        return undefined;
    }
    searchObject(node, keys) {
        if (Array.isArray(node)) {
            for (const child of node) {
                const found = this.searchObject(child, keys);
                if (found)
                    return found;
            }
            return undefined;
        }
        if (node && typeof node === "object") {
            const obj = node;
            if (keys.every((k) => k in obj))
                return obj;
            for (const value of Object.values(obj)) {
                const found = this.searchObject(value, keys);
                if (found)
                    return found;
            }
        }
        return undefined;
    }
    // Searches for the first array whose elements are objects containing all keys.
    findArrayOfObjectsWithKeys(roots, keys) {
        for (const root of roots) {
            const found = this.searchArray(root, keys);
            if (found)
                return found;
        }
        return undefined;
    }
    searchArray(node, keys) {
        if (Array.isArray(node)) {
            if (node.length > 0 &&
                node.every((el) => el != null &&
                    typeof el === "object" &&
                    !Array.isArray(el) &&
                    keys.every((k) => k in el))) {
                return node;
            }
            for (const child of node) {
                const found = this.searchArray(child, keys);
                if (found)
                    return found;
            }
            return undefined;
        }
        if (node && typeof node === "object") {
            for (const value of Object.values(node)) {
                const found = this.searchArray(value, keys);
                if (found)
                    return found;
            }
        }
        return undefined;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    async fetchJson(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const text = Application.arrayBufferToUTF8String(data);
        try {
            return JSON.parse(text);
        }
        catch {
            return undefined;
        }
    }
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
    slugFromId(mangaId) {
        const decoded = this.safeDecode(mangaId).replace(/^\/+/, "");
        const parts = decoded.split("/");
        return parts[parts.length - 1] || decoded;
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
    parseChapterNumber(name) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const iso = value.length >= 19 ? value.substring(0, 19) : value;
        const parsed = new Date(`${iso}Z`);
        if (Number.isNaN(parsed.getTime())) {
            const fallback = new Date(value);
            return Number.isNaN(fallback.getTime()) ? new Date(0) : fallback;
        }
        return parsed;
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
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("hiatus"))
            return "Hiatus";
        if (s.includes("cancelled"))
            return "Cancelled";
        return "Unknown";
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
export const WebdexScans = new WebdexScansExtension();
