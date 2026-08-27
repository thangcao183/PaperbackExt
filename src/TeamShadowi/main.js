import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://www.team-shadowi.com";
const LIMIT = 20;
// Genre filter options ported from the upstream Kotlin GenreFilter.
const GENRES = [
    { id: "all", title: "All" },
    { id: "action", title: "Action" },
    { id: "adventure", title: "Adventure" },
    { id: "comedy", title: "Comedy" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "isekai", title: "Isekai" },
    { id: "romance", title: "Romance" },
];
class TeamShadowiInterceptor extends PaperbackInterceptor {
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
export class TeamShadowiExtension {
    requestManager = new TeamShadowiInterceptor("main");
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
            const items = GENRES.filter((g) => g.id !== "all").map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre: g.id },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const offset = (page - 1) * LIMIT;
        const sortBy = section.id === "latest" ? "created" : "rating";
        const url = `${BASE_URL}/api/series/popular?timePeriod=all&genre=all&sortBy=${sortBy}&offset=${offset}&limit=${LIMIT}`;
        const res = await this.fetchJson({ url, method: "GET" });
        const series = res.data ?? [];
        const items = series.map((s) => ({
            type: section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem",
            mangaId: this.seriesId(s.slug),
            imageUrl: s.thumbnail_url ?? "",
            title: s.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: res.hasMore ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const titleQuery = (query.title || "").trim();
        // Text search endpoint: does not paginate.
        if (titleQuery !== "") {
            const url = `${BASE_URL}/api/search?q=${encodeURIComponent(titleQuery)}`;
            const res = await this.fetchJson({
                url,
                method: "GET",
            });
            const items = (res.series ?? []).map((s) => ({
                mangaId: this.seriesId(s.slug),
                imageUrl: s.thumbnail_url ?? "",
                title: s.title,
                subtitle: undefined,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        // Browse endpoint with genre/sort filters.
        const meta = metadata;
        const page = meta?.page ?? 1;
        const offset = (page - 1) * LIMIT;
        // On the first page take filters from the search query; on later pages
        // re-use the genre/sort carried in the pagination metadata.
        const queryFilters = this.readFilters(query);
        const genre = meta?.genre ?? queryFilters.genre;
        const sort = meta?.sort ?? queryFilters.sort;
        const url = `${BASE_URL}/api/series/popular?offset=${offset}&limit=${LIMIT}&timePeriod=all&genre=${encodeURIComponent(genre)}&sortBy=${encodeURIComponent(sort)}`;
        const res = await this.fetchJson({ url, method: "GET" });
        const series = res.data ?? [];
        const items = series.map((s) => ({
            mangaId: this.seriesId(s.slug),
            imageUrl: s.thumbnail_url ?? "",
            title: s.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items,
            metadata: res.hasMore ? { page: page + 1, genre, sort } : undefined,
        };
    }
    readFilters(query) {
        let genre = "all";
        let sort = "rating";
        const meta = query.metadata;
        if (meta && typeof meta === "object" && !Array.isArray(meta)) {
            const g = meta.genre;
            const s = meta.sort;
            if (typeof g === "string" && g.length > 0)
                genre = g;
            if (typeof s === "string" && s.length > 0)
                sort = s;
        }
        return { genre, sort };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const payloads = await this.fetchRscPayloads({
            url,
            method: "GET",
            headers: { Rsc: "1" },
        });
        const node = this.findNode(payloads, (o) => "series" in o && this.isObject(o.series));
        const seriesObj = node ? node.series : {};
        const title = this.asString(seriesObj.title) || this.safeDecode(mangaId);
        const synopsis = this.asString(seriesObj.description);
        const thumbnailUrl = this.asString(seriesObj.thumbnail_url);
        const status = this.parseStatus(this.asString(seriesObj.status));
        const genres = this.asStringArray(seriesObj.genres);
        const tags = this.asStringArray(seriesObj.tags);
        const allTags = Array.from(new Set([...genres, ...tags])).filter((t) => t.length > 0);
        const tagGroups = [];
        if (allTags.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: allTags.map((t) => ({
                    id: t.toLowerCase().replace(/\s+/g, "-"),
                    title: t,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
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
        const url = this.mangaUrl(sourceManga.mangaId);
        const payloads = await this.fetchRscPayloads({
            url,
            method: "GET",
            headers: { Rsc: "1" },
        });
        const slug = this.slugFromId(sourceManga.mangaId);
        // Find the array of chapter objects (each has number; id/title/created_at).
        const chaptersNode = this.findArray(payloads, (arr) => arr.length > 0 &&
            this.isObject(arr[0]) &&
            "number" in arr[0]);
        const raw = chaptersNode ?? [];
        const chapters = [];
        for (const entry of raw) {
            if (!this.isObject(entry))
                continue;
            const chap = entry;
            const numVal = chap.number;
            const chapNum = typeof numVal === "number"
                ? numVal
                : parseFloat(this.asString(numVal)) || 0;
            const numStr = this.trimZero(chapNum);
            const titleText = this.asString(chap.title);
            const name = titleText
                ? `Chapter ${numStr}: ${titleText}`
                : `Chapter ${numStr}`;
            const chapterId = this.toSafeId(`read/${slug}/${numStr}`);
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum,
                publishDate: this.parseDate(this.asString(chap.created_at)),
                langCode: "🇬🇧",
            });
        }
        chapters.sort((a, b) => b.chapNum - a.chapNum);
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const payloads = await this.fetchRscPayloads({
            url,
            method: "GET",
            headers: { Rsc: "1" },
        });
        const node = this.findNode(payloads, (o) => Array.isArray(o.pages));
        const rawPages = node ? node.pages : [];
        const pages = [];
        for (const p of rawPages) {
            const src = this.asString(p);
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
    // URL / id helpers
    // ----------------------------------------------------------------
    seriesId(slug) {
        return this.toSafeId(`series/${slug.replace(/^\/+/, "")}`);
    }
    slugFromId(mangaId) {
        const path = this.safeDecode(mangaId).replace(/^\/+/, "");
        const parts = path.split("/").filter((s) => s.length > 0);
        return parts.length > 0 ? parts[parts.length - 1] : path;
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
        const s = (status || "").toLowerCase();
        if (s.includes("ongoing"))
            return "Ongoing";
        if (s.includes("completed"))
            return "Completed";
        return "Unknown";
    }
    trimZero(num) {
        if (Number.isInteger(num))
            return num.toString();
        return num.toString();
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const clean = value.split("+")[0].split("Z")[0];
        const d = new Date(`${clean}Z`);
        if (!isNaN(d.getTime()))
            return d;
        const d2 = new Date(value);
        return isNaN(d2.getTime()) ? new Date(0) : d2;
    }
    // ----------------------------------------------------------------
    // JSON value helpers
    // ----------------------------------------------------------------
    isObject(v) {
        return typeof v === "object" && v !== null && !Array.isArray(v);
    }
    asString(v) {
        if (typeof v === "string")
            return v.trim();
        if (typeof v === "number")
            return v.toString();
        return "";
    }
    asStringArray(v) {
        if (!Array.isArray(v))
            return [];
        return v.filter((x) => typeof x === "string");
    }
    // ----------------------------------------------------------------
    // Next.js RSC parsing (ported from keiyoushi NextJs.kt)
    // ----------------------------------------------------------------
    // Recursively search the resolved payloads for an object matching the predicate.
    findNode(payloads, predicate) {
        for (const p of payloads) {
            const r = this.searchObject(p, predicate);
            if (r)
                return r;
        }
        return undefined;
    }
    searchObject(node, predicate) {
        if (this.isObject(node)) {
            if (predicate(node))
                return node;
            for (const key of Object.keys(node)) {
                const r = this.searchObject(node[key], predicate);
                if (r)
                    return r;
            }
        }
        else if (Array.isArray(node)) {
            for (const child of node) {
                const r = this.searchObject(child, predicate);
                if (r)
                    return r;
            }
        }
        return undefined;
    }
    findArray(payloads, predicate) {
        for (const p of payloads) {
            const r = this.searchArray(p, predicate);
            if (r)
                return r;
        }
        return undefined;
    }
    searchArray(node, predicate) {
        if (Array.isArray(node)) {
            if (predicate(node))
                return node;
            for (const child of node) {
                const r = this.searchArray(child, predicate);
                if (r)
                    return r;
            }
        }
        else if (this.isObject(node)) {
            for (const key of Object.keys(node)) {
                const r = this.searchArray(node[key], predicate);
                if (r)
                    return r;
            }
        }
        return undefined;
    }
    // Fetch a page with the Rsc header and return resolved RSC payload trees.
    async fetchRscPayloads(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const body = Application.arrayBufferToUTF8String(data);
        const chunkCache = {};
        const modelCache = {};
        let payloads = this.extractRscPayloads(body, chunkCache, modelCache);
        if (payloads.length === 0) {
            // HTML document: pull flight chunks from inline __next_f.push scripts.
            payloads = this.extractFromHtml(body, chunkCache, modelCache);
        }
        return payloads.map((p) => this.resolveRefs(p, chunkCache, modelCache, []));
    }
    extractFromHtml(html, chunkCache, modelCache) {
        const dom = htmlparser2.parseDocument(html);
        const $ = cheerio.load(dom);
        const results = [];
        const re = /self\.__next_f\.push\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/;
        $("script:not([src])").each((_, el) => {
            const script = $(el).text();
            if (!script.includes("self.__next_f.push"))
                return;
            const m = script.match(re);
            if (!m)
                return;
            try {
                const arr = JSON.parse(m[1]);
                const content = arr.length > 1 ? arr[1] : undefined;
                if (typeof content !== "string")
                    return;
                for (const p of this.extractRscPayloads(content, chunkCache, modelCache)) {
                    results.push(p);
                }
            }
            catch {
                // ignore malformed scripts
            }
        });
        return results;
    }
    // Parse the raw RSC flight body into JSON payloads, populating the chunk/model caches.
    extractRscPayloads(body, chunkCache, modelCache) {
        const results = [];
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
            if (body[pos] === "T") {
                // Binary chunk: T<hexLen>,<content>; len is UTF-8 byte length.
                pos++;
                const commaIdx = body.indexOf(",", pos);
                if (commaIdx === -1)
                    break;
                const byteLen = parseInt(body.substring(pos, commaIdx), 16);
                if (isNaN(byteLen))
                    break;
                pos = commaIdx + 1;
                let bytes = 0;
                const start = pos;
                while (pos < body.length && bytes < byteLen) {
                    const code = body.charCodeAt(pos);
                    if (code < 0x80) {
                        bytes += 1;
                    }
                    else if (code < 0x800) {
                        bytes += 2;
                    }
                    else if (code >= 0xd800 && code <= 0xdbff) {
                        bytes += 4;
                        pos++;
                    }
                    else {
                        bytes += 3;
                    }
                    pos++;
                }
                const chunkContent = body.substring(start, pos);
                chunkCache[id] = chunkContent;
                try {
                    results.push(JSON.parse(chunkContent));
                }
                catch {
                    // not JSON
                }
            }
            else {
                const parsed = this.parseJsonAt(body, pos);
                if (parsed.element !== undefined) {
                    results.push(parsed.element);
                    modelCache[id] = parsed.element;
                }
                pos = parsed.end;
            }
        }
        return results;
    }
    parseJsonAt(body, start) {
        if (start >= body.length)
            return { element: undefined, end: start };
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
            if (c === "{" || c === "[") {
                depth++;
            }
            else if (c === "}" || c === "]") {
                if (--depth === 0) {
                    try {
                        return { element: JSON.parse(body.substring(start, i)), end: i };
                    }
                    catch {
                        return { element: undefined, end: i };
                    }
                }
            }
            if (depth === 0 && /\s/.test(c)) {
                try {
                    return {
                        element: JSON.parse(body.substring(start, i - 1)),
                        end: i,
                    };
                }
                catch {
                    return { element: undefined, end: i };
                }
            }
        }
        return { element: undefined, end: i };
    }
    // Resolve React Flight `$`-references into concrete JSON.
    resolveRefs(element, chunkCache, modelCache, resolving) {
        if (Array.isArray(element)) {
            return element.map((e) => this.resolveRefs(e, chunkCache, modelCache, resolving));
        }
        if (this.isObject(element)) {
            const out = {};
            for (const key of Object.keys(element)) {
                out[key] = this.resolveRefs(element[key], chunkCache, modelCache, resolving);
            }
            return out;
        }
        if (typeof element === "string" && element.startsWith("$") && element.length >= 2) {
            const str = element;
            if (str === "$undefined")
                return null;
            if (str === "$Infinity" ||
                str === "$-Infinity" ||
                str === "$NaN" ||
                str === "$-0") {
                return str.substring(1);
            }
            const c = str[1];
            if (c === "$")
                return str.substring(1);
            if (c === "D")
                return str.substring(2);
            if (c === "n")
                return str.substring(2);
            if (c === "Q") {
                const r = this.resolveMapRef(str.substring(2), chunkCache, modelCache, resolving);
                return r !== undefined ? r : element;
            }
            if (c === "W") {
                const r = this.resolveSetRef(str.substring(2), chunkCache, modelCache, resolving);
                return r !== undefined ? r : element;
            }
            const r = this.resolveModelRef(str.substring(1), chunkCache, modelCache, resolving);
            return r !== undefined ? r : element;
        }
        return element;
    }
    resolveModelRef(reference, chunkCache, modelCache, resolving) {
        const segments = reference.split(":");
        const id = segments[0];
        if (segments.length === 1 && id in chunkCache) {
            return chunkCache[id];
        }
        if (resolving.includes(id))
            return undefined;
        const guard = [...resolving, id];
        if (!(id in modelCache))
            return undefined;
        let value = modelCache[id];
        for (let i = 1; i < segments.length; i++) {
            if (typeof value === "string" &&
                value.startsWith("$")) {
                value = this.resolveRefs(value, chunkCache, modelCache, guard);
            }
            value = this.walkRefSegment(value, segments[i]);
            if (value === undefined)
                return undefined;
        }
        return this.resolveRefs(value, chunkCache, modelCache, guard);
    }
    walkRefSegment(value, segment) {
        if (this.isObject(value)) {
            return value[segment];
        }
        if (Array.isArray(value)) {
            if (value.length >= 4 && value[0] === "$") {
                if (segment === "type")
                    return value[1];
                if (segment === "key")
                    return value[2];
                if (segment === "props")
                    return value[3];
            }
            const idx = parseInt(segment, 10);
            return isNaN(idx) ? undefined : value[idx];
        }
        return undefined;
    }
    resolveMapRef(id, chunkCache, modelCache, resolving) {
        if (resolving.includes(id))
            return undefined;
        const entries = modelCache[id];
        if (!Array.isArray(entries))
            return undefined;
        const resolved = this.resolveRefs(entries, chunkCache, modelCache, [
            ...resolving,
            id,
        ]);
        if (!Array.isArray(resolved))
            return undefined;
        const out = {};
        for (const pair of resolved) {
            if (Array.isArray(pair) && pair.length === 2) {
                const key = typeof pair[0] === "string" ? pair[0] : String(pair[0]);
                out[key] = pair[1];
            }
        }
        return out;
    }
    resolveSetRef(id, chunkCache, modelCache, resolving) {
        if (resolving.includes(id))
            return undefined;
        const values = modelCache[id];
        if (!Array.isArray(values))
            return undefined;
        return this.resolveRefs(values, chunkCache, modelCache, [
            ...resolving,
            id,
        ]);
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
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
export const TeamShadowi = new TeamShadowiExtension();
