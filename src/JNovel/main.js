import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const DOMAIN = "j-novel.club";
const BASE_URL = `https://${DOMAIN}`;
function isHexId(id) {
    if (id.length === 0)
        return false;
    for (const c of id) {
        if (!/[0-9a-fA-F]/.test(c))
            return false;
    }
    return true;
}
function parseJsonAt(body, start) {
    if (start >= body.length)
        return [null, start];
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
                    return [JSON.parse(body.substring(start, i)), i];
                }
                catch {
                    return [null, i];
                }
            }
        }
        if (depth === 0 && /\s/.test(c)) {
            try {
                return [JSON.parse(body.substring(start, i - 1)), i];
            }
            catch {
                return [null, i];
            }
        }
    }
    return [null, i];
}
function utf8ByteLen(ch) {
    const code = ch.charCodeAt(0);
    if (code < 0x80)
        return 1;
    if (code < 0x800)
        return 2;
    return 3;
}
function extractRscPayloads(body) {
    const payloads = [];
    const chunkCache = new Map();
    const modelCache = new Map();
    let pos = 0;
    while (pos < body.length) {
        const colonIdx = body.indexOf(":", pos);
        if (colonIdx === -1)
            break;
        const id = body.substring(pos, colonIdx);
        if (!isHexId(id)) {
            pos++;
            continue;
        }
        pos = colonIdx + 1;
        if (pos >= body.length)
            break;
        if (body[pos] === "T") {
            // Binary chunk: T<hexLen>,<content> where hexLen is UTF-8 byte length.
            pos++;
            const commaIdx = body.indexOf(",", pos);
            if (commaIdx === -1)
                break;
            const byteLen = parseInt(body.substring(pos, commaIdx), 16);
            if (Number.isNaN(byteLen))
                break;
            pos = commaIdx + 1;
            let bytes = 0;
            const start = pos;
            while (pos < body.length && bytes < byteLen) {
                const c = body[pos];
                const code = c.charCodeAt(0);
                if (code >= 0xd800 && code <= 0xdbff) {
                    // high surrogate -> supplementary character is 4 UTF-8 bytes
                    bytes += 4;
                    pos++; // consume the high surrogate; loop increment handles the low
                }
                else {
                    bytes += utf8ByteLen(c);
                }
                pos++;
            }
            const chunkContent = body.substring(start, pos);
            chunkCache.set(id, chunkContent);
            try {
                payloads.push(JSON.parse(chunkContent));
            }
            catch {
                // not JSON, only useful as a string chunk reference
            }
        }
        else {
            const [element, end] = parseJsonAt(body, pos);
            if (element !== null) {
                payloads.push(element);
                modelCache.set(id, element);
            }
            pos = end;
        }
    }
    return { payloads, chunkCache, modelCache };
}
function resolveRefs(element, chunkCache, modelCache, resolving = new Set()) {
    if (Array.isArray(element)) {
        return element.map((e) => resolveRefs(e, chunkCache, modelCache, resolving));
    }
    if (element !== null && typeof element === "object") {
        const out = {};
        for (const key of Object.keys(element)) {
            out[key] = resolveRefs(element[key], chunkCache, modelCache, resolving);
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
        const marker = str[1];
        if (marker === "$")
            return str.substring(1); // escaped '$'
        if (marker === "D")
            return str.substring(2); // Date ISO string
        if (marker === "n")
            return str.substring(2); // BigInt digit string
        if (marker === "Q") {
            return (resolveMapRef(str.substring(2), chunkCache, modelCache, resolving) ??
                element);
        }
        if (marker === "W") {
            return (resolveSetRef(str.substring(2), chunkCache, modelCache, resolving) ??
                element);
        }
        return (resolveModelRef(str.substring(1), chunkCache, modelCache, resolving) ??
            element);
    }
    return element;
}
function walkRefSegment(value, segment) {
    if (Array.isArray(value)) {
        if (value.length >= 4 && value[0] === "$") {
            if (segment === "type")
                return value[1];
            if (segment === "key")
                return value[2];
            if (segment === "props")
                return value[3];
        }
        const idx = Number.parseInt(segment, 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx < value.length)
            return value[idx];
        return null;
    }
    if (value !== null && typeof value === "object") {
        return segment in value ? value[segment] : null;
    }
    return null;
}
function resolveModelRef(reference, chunkCache, modelCache, resolving) {
    const segments = reference.split(":");
    const id = segments[0];
    if (segments.length === 1) {
        const chunk = chunkCache.get(id);
        if (chunk !== undefined)
            return chunk;
    }
    if (resolving.has(id))
        return null;
    const guard = new Set(resolving);
    guard.add(id);
    let value = modelCache.get(id);
    if (value === undefined)
        return null;
    for (let i = 1; i < segments.length; i++) {
        if (typeof value === "string" && value.startsWith("$")) {
            value = resolveRefs(value, chunkCache, modelCache, guard);
        }
        const next = walkRefSegment(value, segments[i]);
        if (next === null)
            return null;
        value = next;
    }
    return resolveRefs(value, chunkCache, modelCache, guard);
}
function resolveMapRef(id, chunkCache, modelCache, resolving) {
    if (resolving.has(id))
        return null;
    const entries = modelCache.get(id);
    if (!Array.isArray(entries))
        return null;
    const guard = new Set(resolving);
    guard.add(id);
    const resolved = resolveRefs(entries, chunkCache, modelCache, guard);
    if (!Array.isArray(resolved))
        return null;
    const out = {};
    for (const pair of resolved) {
        if (Array.isArray(pair) && pair.length === 2) {
            const key = typeof pair[0] === "string" ? pair[0] : String(pair[0]);
            out[key] = pair[1];
        }
    }
    return out;
}
function resolveSetRef(id, chunkCache, modelCache, resolving) {
    if (resolving.has(id))
        return null;
    const values = modelCache.get(id);
    if (!Array.isArray(values))
        return null;
    const guard = new Set(resolving);
    guard.add(id);
    return resolveRefs(values, chunkCache, modelCache, guard);
}
function findFirst(element, predicate) {
    if (Array.isArray(element)) {
        for (const child of element) {
            const r = findFirst(child, predicate);
            if (r)
                return r;
        }
        return null;
    }
    if (element !== null && typeof element === "object") {
        if (predicate(element))
            return element;
        for (const key of Object.keys(element)) {
            const r = findFirst(element[key], predicate);
            if (r)
                return r;
        }
    }
    return null;
}
function extractNextJs(body, predicate) {
    const { payloads, chunkCache, modelCache } = extractRscPayloads(body);
    for (const payload of payloads) {
        const resolved = resolveRefs(payload, chunkCache, modelCache);
        const result = findFirst(resolved, predicate);
        if (result)
            return result;
    }
    return null;
}
// ----------------------------------------------------------------
// Interceptor
// ----------------------------------------------------------------
class JNovelInterceptor extends PaperbackInterceptor {
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
export class JNovelExtension {
    requestManager = new JNovelInterceptor("main");
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
                title: "Manga",
                type: DiscoverSectionType.featured,
            },
        ];
    }
    async getDiscoverSectionItems(_section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const url = `${BASE_URL}/series?type=manga&page=${page}`;
        const { series, hasNextPage } = await this.fetchSeriesList(url);
        const items = series.map((s) => ({
            type: "simpleCarouselItem",
            mangaId: s.mangaId,
            imageUrl: s.imageUrl,
            title: s.title,
            metadata: undefined,
        }));
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const params = ["type=manga", `page=${page}`];
        if (titleQuery.length > 0) {
            params.push(`search=${encodeURIComponent(titleQuery)}`);
        }
        const url = `${BASE_URL}/series?${params.join("&")}`;
        const { series, hasNextPage } = await this.fetchSeriesList(url);
        const results = series.map((s) => ({
            mangaId: s.mangaId,
            imageUrl: s.imageUrl,
            title: s.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items: results, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    async fetchSeriesList(url) {
        const body = await this.fetchRsc(url);
        const root = extractNextJs(body, (e) => "seriesList" in e && typeof e.seriesList === "object");
        const series = [];
        let hasNextPage = false;
        const seriesList = root?.seriesList;
        if (seriesList !== null && typeof seriesList === "object" && !Array.isArray(seriesList)) {
            const nextPageToken = seriesList.nextPageToken;
            hasNextPage = typeof nextPageToken === "string" && nextPageToken.length > 0;
            const list = seriesList.series;
            if (Array.isArray(list)) {
                for (const item of list) {
                    if (item === null || typeof item !== "object" || Array.isArray(item)) {
                        continue;
                    }
                    const slug = typeof item.slug === "string" ? item.slug : "";
                    const title = typeof item.title === "string" ? item.title : "";
                    if (!slug || !title)
                        continue;
                    series.push({
                        mangaId: this.toSafeId(slug),
                        title,
                        imageUrl: this.coverUrl(item.cover),
                    });
                }
            }
        }
        return { series, hasNextPage };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const body = await this.fetchRsc(url);
        const root = extractNextJs(body, (e) => "series" in e && "volumes" in e && Array.isArray(e.volumes));
        const seriesObj = root?.series;
        const series = seriesObj !== null &&
            typeof seriesObj === "object" &&
            !Array.isArray(seriesObj)
            ? seriesObj
            : {};
        const title = typeof series.title === "string" && series.title.length > 0
            ? series.title
            : this.safeDecode(mangaId);
        const synopsis = typeof series.description === "string" ? series.description : "";
        const thumbnailUrl = this.bannerUrl(series.banner);
        const tags = Array.isArray(series.tags)
            ? series.tags.filter((t) => typeof t === "string")
            : [];
        // Creators come from the first volume's volume info.
        const creators = this.firstVolumeCreators(root?.volumes);
        const author = this.namesByRole(creators, 1);
        const artist = this.namesByRole(creators, 4);
        const tagGroups = [];
        if (tags.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
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
                secondaryTitles: [],
                thumbnailUrl,
                author,
                artist,
                synopsis,
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(series.status),
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
        const body = await this.fetchRsc(url);
        const root = extractNextJs(body, (e) => "series" in e && "volumes" in e && Array.isArray(e.volumes));
        const seriesObj = root?.series;
        const mangaTitle = seriesObj !== null &&
            typeof seriesObj === "object" &&
            !Array.isArray(seriesObj) &&
            typeof seriesObj.title === "string"
            ? seriesObj.title
            : "";
        const chapters = [];
        const seen = new Set();
        const volumesRaw = root?.volumes;
        const volumes = Array.isArray(volumesRaw) ? volumesRaw : [];
        for (const volume of volumes) {
            if (volume === null || typeof volume !== "object" || Array.isArray(volume)) {
                continue;
            }
            const volInfo = volume.volume;
            const owned = volInfo !== null &&
                typeof volInfo === "object" &&
                !Array.isArray(volInfo) &&
                volInfo.owned === true;
            const parts = Array.isArray(volume.parts) ? volume.parts : [];
            for (const part of parts) {
                if (part === null || typeof part !== "object" || Array.isArray(part)) {
                    continue;
                }
                const slug = typeof part.slug === "string" ? part.slug : "";
                if (!slug)
                    continue;
                const chapterId = this.toSafeId(slug);
                if (seen.has(chapterId))
                    continue;
                seen.add(chapterId);
                const rawTitle = typeof part.title === "string" ? part.title : "";
                const locked = this.isLocked(part, owned);
                const lock = locked ? "🔒 " : "";
                const stripped = mangaTitle
                    ? rawTitle.replace(mangaTitle, "").trim()
                    : rawTitle.trim();
                const chapterName = (stripped.length > 0 ? stripped : rawTitle) || slug;
                const number = typeof part.number === "number" ? part.number : -1;
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: lock + chapterName,
                    volume: 0,
                    chapNum: number,
                    publishDate: this.parseLaunchDate(part.launch),
                    langCode: "🇬🇧",
                });
            }
        }
        // Upstream reverses the flattened list (newest first).
        return chapters.reverse();
    }
    async getChapterDetails(_chapter) {
        // Reading pages requires logging in via WebView, purchasing the chapter,
        // and decrypting the E4P-protected image manifest (TIFF/XEBP). That flow
        // cannot be reproduced without authentication and the proprietary E4P
        // decoder, so page extraction is not supported in this port.
        throw new Error("Log in via WebView and purchase this chapter to read. Reading is not supported in this extension.");
    }
    getMangaShareUrl(mangaId) {
        return this.mangaUrl(mangaId);
    }
    // ----------------------------------------------------------------
    // Field helpers
    // ----------------------------------------------------------------
    coverUrl(cover) {
        if (cover === null || typeof cover !== "object" || Array.isArray(cover)) {
            return "";
        }
        const coverUrl = cover.coverUrl;
        if (typeof coverUrl !== "string" || coverUrl.length === 0)
            return "";
        // Upstream rewrites path segment index 2 to "1200" for a larger image.
        try {
            const u = new URL(coverUrl);
            const segments = u.pathname.split("/");
            // pathname starts with "/", so segments[0] is empty; index 2 maps to
            // the same path segment the Kotlin setPathSegment(2, ...) targets.
            if (segments.length > 3) {
                segments[3] = "1200";
                u.pathname = segments.join("/");
                return u.toString();
            }
            return coverUrl;
        }
        catch {
            return coverUrl;
        }
    }
    bannerUrl(banner) {
        if (banner === null || typeof banner !== "object" || Array.isArray(banner)) {
            return "";
        }
        const originalUrl = banner.originalUrl;
        return typeof originalUrl === "string" ? originalUrl : "";
    }
    firstVolumeCreators(volumes) {
        if (!Array.isArray(volumes) || volumes.length === 0)
            return [];
        const first = volumes[0];
        if (first === null || typeof first !== "object" || Array.isArray(first)) {
            return [];
        }
        const volInfo = first.volume;
        if (volInfo === null ||
            typeof volInfo !== "object" ||
            Array.isArray(volInfo)) {
            return [];
        }
        return Array.isArray(volInfo.creators) ? volInfo.creators : [];
    }
    namesByRole(creators, role) {
        const names = [];
        for (const creator of creators) {
            if (creator === null ||
                typeof creator !== "object" ||
                Array.isArray(creator)) {
                continue;
            }
            if (creator.role === role && typeof creator.name === "string") {
                names.push(creator.name);
            }
        }
        return names.length > 0 ? names.join(", ") : undefined;
    }
    isLocked(part, owned) {
        const preview = part.preview;
        const rental = part.rental;
        const rentalAbsent = rental === null || rental === undefined || rental === false;
        return !owned && preview === false && rentalAbsent;
    }
    parseLaunchDate(launch) {
        if (launch === null || typeof launch !== "object" || Array.isArray(launch)) {
            return new Date(0);
        }
        const seconds = launch.seconds;
        if (typeof seconds === "string" && seconds.length > 0) {
            const secs = Number.parseInt(seconds, 10);
            if (!Number.isNaN(secs))
                return new Date(secs * 1000);
        }
        if (typeof seconds === "number") {
            return new Date(seconds * 1000);
        }
        return new Date(0);
    }
    parseStatus(status) {
        switch (status) {
            case 0:
                return "Ongoing";
            case 1:
                return "Completed";
            case 2:
                return "Hiatus";
            default:
                return "Unknown";
        }
    }
    // ----------------------------------------------------------------
    // URL / id helpers
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/series/${slug.replace(/^\/+/, "")}`;
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
    async fetchRsc(url) {
        const request = {
            url,
            method: "GET",
            headers: { rsc: "1" },
        };
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        return Application.arrayBufferToUTF8String(data);
    }
}
export const JNovel = new JNovelExtension();
