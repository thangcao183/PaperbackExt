import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { base64Decode, base64Encode, bufToHex, decryptSecretStream, getRandomBytes, hmacSha256Hex, sha256, x25519PublicKey, x25519ScalarMult, } from "./crypto";
const BASE_URL = "https://theblank.net";
// ----------------------------------------------------------------
// Filter option tables (ported verbatim from the upstream Kotlin)
// ----------------------------------------------------------------
const SORT_VALUES = [
    { name: "New Series", value: "date" },
    { name: "Trending", value: "trending" },
    { name: "Recently Updated", value: "recently" },
    { name: "Most Views", value: "views" },
    { name: "A-Z", value: "alphabetical" },
];
const GENRES = [
    { name: "Action", value: "action" },
    { name: "Adventure", value: "adventure" },
    { name: "Ai", value: "ai" },
    { name: "Animated", value: "animated" },
    { name: "Anthology", value: "anthology" },
    { name: "Cohabitation", value: "cohabitation" },
    { name: "College", value: "college" },
    { name: "Comedy", value: "comedy" },
    { name: "Doujinshi", value: "doujinshi" },
    { name: "Drama", value: "drama" },
    { name: "Fantasy", value: "fantasy" },
    { name: "Folklore", value: "folklore" },
    { name: "Harem", value: "harem" },
    { name: "Historical", value: "historical" },
    { name: "Horror", value: "horror" },
    { name: "Isekai", value: "isekai" },
    { name: "Josei", value: "josei" },
    { name: "Love triangle", value: "love-triangle" },
    { name: "Martial arts", value: "martial-arts" },
    { name: "Mature", value: "mature" },
    { name: "Murim", value: "murim" },
    { name: "Mystery", value: "mystery" },
    { name: "Office workers", value: "office-workers" },
    { name: "Psychological", value: "psychological" },
    { name: "Robots", value: "robots" },
    { name: "Romance", value: "romance" },
    { name: "School life", value: "school-life" },
    { name: "Sci-fi", value: "sci-fi" },
    { name: "Seinen", value: "seinen" },
    { name: "Shoujo", value: "shoujo" },
    { name: "Shounen", value: "shounen" },
    { name: "Slice of life", value: "slice-of-life" },
    { name: "Smut", value: "smut" },
    { name: "Sports", value: "sports" },
    { name: "Supernatural", value: "supernatural" },
    { name: "Superpower", value: "superpower" },
    { name: "System", value: "system" },
    { name: "Thriller", value: "thriller" },
    { name: "Uncensored", value: "uncensored" },
    { name: "Violence", value: "violence" },
    { name: "Workplace", value: "workplace" },
];
/**
 * Global session store keyed by "serieSlug--chapterSlug".
 * Populated during getChapterDetails, consumed by the interceptor.
 */
const chapterSessions = new Map();
function sessionKey(serieSlug, chapterSlug) {
    return `${serieSlug}--${chapterSlug}`;
}
/**
 * Case-insensitive header lookup. Paperback delivers response headers as a
 * plain Record<string,string>, and the casing of server-sent headers
 * (e.g. X-Page-Name / X-Key-Hint) is not guaranteed, so we scan keys
 * case-insensitively rather than assuming a lowercase key.
 */
function headerValue(headers, name) {
    if (!headers)
        return "";
    const direct = headers[name];
    if (direct !== undefined)
        return direct;
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower)
            return headers[key];
    }
    return "";
}
class TheBlankInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        // Defaults first, then spread the request's own headers LAST so that
        // per-request headers (Accept: application/json, X-Requested-With,
        // X-Inertia, X-XSRF-TOKEN, ...) set by fetchJson/fetchInertia win.
        // The /page/{N} endpoint serves encrypted chapter images.
        const url = request.url ?? "";
        const isPageImage = /\/serie\/[^/]+\/chapter\/[^/]+\/page\/\d+/.test(url);
        const defaultAccept = isPageImage
            ? "image/webp,image/apng,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
        const extraHeaders = {};
        // Add X-Client-Pubkey header AND sign the URL freshly for page image
        // requests. Signing must happen here (not in getChapterDetails) because
        // Paperback re-requests the same page URL when the reader scrolls back to
        // an already-viewed page. A signature baked in at getChapterDetails time
        // carries a stale `ts` and the server rejects it on re-fetch, so the image
        // "disappears". Computing ts/nonce/sig per request keeps every (re)fetch
        // valid. This mirrors keiyoushi's Pam.imageRequest.
        if (isPageImage) {
            const m = url.match(/\/serie\/([^/?#]+)\/chapter\/([^/?#]+)\/page\/(\d+)/);
            if (m) {
                const serieSlug = decodeURIComponent(m[1]);
                const chapterSlug = decodeURIComponent(m[2]);
                const pageIndex = m[3];
                const session = chapterSessions.get(sessionKey(serieSlug, chapterSlug));
                if (session) {
                    extraHeaders["x-client-pubkey"] = session.clientPubkeyB64;
                    // Re-sign every request with a fresh timestamp + nonce.
                    const ts = Math.floor(Date.now() / 1000).toString();
                    const nonce = bufToHex(getRandomBytes(16));
                    const sig = await hmacSha256Hex(session.chapterToken, `${pageIndex}${ts}${nonce}`);
                    request.url =
                        `${BASE_URL}/serie/${serieSlug}/chapter/${chapterSlug}/page/${pageIndex}` +
                            `?token=${encodeURIComponent(session.chapterToken)}` +
                            `&ts=${ts}&nonce=${nonce}&sig=${sig}`;
                    console.log(`[TheBlank] req page signed pubkey=${session.clientPubkeyB64} ` +
                        `serie=${serieSlug} chapter=${chapterSlug} page=${pageIndex} ts=${ts}`);
                }
                else {
                    console.log(`[TheBlank] req page NO SESSION serie=${serieSlug} chapter=${chapterSlug} ` +
                        `known=[${[...chapterSessions.keys()].join(" | ")}]`);
                }
            }
        }
        request.headers = {
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: defaultAccept,
            "accept-language": "en-US,en;q=0.5",
            ...extraHeaders,
            ...request.headers,
        };
        return request;
    }
    async interceptResponse(request, response, data) {
        if (headerValue(response.headers, "cf-mitigated") === "challenge") {
            throw new CloudflareError({
                url: request.url,
                method: request.method ?? "GET",
                headers: {
                    "user-agent": await Application.getDefaultUserAgent(),
                },
            });
        }
        // Decrypt encrypted page image responses from the /page/ endpoint
        const url = request.url ?? "";
        const pageMatch = url.match(/\/serie\/([^/]+)\/chapter\/([^/]+)\/page\/\d+/);
        if (pageMatch && data.byteLength > 0) {
            const serieSlug = decodeURIComponent(pageMatch[1]);
            const chapterSlug = decodeURIComponent(pageMatch[2]);
            const session = chapterSessions.get(sessionKey(serieSlug, chapterSlug));
            console.log(`[TheBlank] page response url=${url} bytes=${data.byteLength} ` +
                `headerKeys=[${Object.keys(response.headers ?? {}).join(",")}] ` +
                `sessionFound=${!!session} ` +
                `knownSessions=[${[...chapterSessions.keys()].join(" | ")}]`);
            if (session) {
                const pageName = headerValue(response.headers, "x-page-name");
                const keyHintB64 = headerValue(response.headers, "x-key-hint");
                console.log(`[TheBlank] pageName="${pageName}" keyHintB64Len=${keyHintB64.length}`);
                if (pageName && keyHintB64) {
                    const keyHint = base64Decode(keyHintB64);
                    if (keyHint.length >= 32) {
                        // Derive the stream key: SHA256(sharedSecret ‖ pageName) XOR keyHint[0:32]
                        const enc = new TextEncoder();
                        const pageNameBytes = enc.encode(pageName);
                        const hashInput = new Uint8Array(session.sharedSecret.length + pageNameBytes.length);
                        hashInput.set(session.sharedSecret);
                        hashInput.set(pageNameBytes, session.sharedSecret.length);
                        const hash = await sha256(hashInput);
                        const streamKey = new Uint8Array(32);
                        for (let i = 0; i < 32; i++) {
                            streamKey[i] = hash[i] ^ keyHint[i];
                        }
                        // Decrypt the secretstream payload
                        const payload = new Uint8Array(data);
                        const decrypted = decryptSecretStream(streamKey, payload);
                        console.log(`[TheBlank] decrypt result=${decrypted ? "ok len=" + decrypted.length : "NULL"} ` +
                            `sharedLen=${session.sharedSecret.length} keyHintLen=${keyHint.length} payloadLen=${payload.length}`);
                        if (decrypted) {
                            return decrypted.buffer;
                        }
                    }
                    else {
                        console.log(`[TheBlank] keyHint too short: ${keyHint.length}`);
                    }
                }
            }
        }
        return data;
    }
}
export class TheBlankExtension {
    requestManager = new TheBlankInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 1,
        bufferInterval: 2,
        ignoreImages: true,
    });
    // Cached Inertia version (data-page version attribute on the home page).
    inertiaVersion = undefined;
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
                id: "trending",
                title: "Trending",
                type: DiscoverSectionType.featured,
            },
            {
                id: "recently",
                title: "Recently Updated",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "date",
                title: "New Series",
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
                name: g.name,
                searchQuery: {
                    title: "",
                    metadata: { genre: g.value },
                },
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const json = await this.fetchLibrary({ page, orderby: section.id });
        const data = json.series?.data ?? [];
        const items = [];
        const seen = new Set();
        for (const m of data) {
            const parsed = this.browseToItem(m);
            if (!parsed)
                continue;
            if (seen.has(parsed.mangaId))
                continue;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "trending"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        }
        const current = json.series?.meta?.current_page ?? page;
        const last = json.series?.meta?.last_page ?? page;
        return {
            items,
            metadata: current < last ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const titleQuery = (query.title || "").trim();
        // Text search ignores filters (matching upstream behavior) and is
        // a single, non-paged API call returning a flat array.
        if (titleQuery.length > 0) {
            const url = `${BASE_URL}/api/v1/search/series?q=${encodeURIComponent(titleQuery)}`;
            const data = await this.fetchJson(url);
            const list = Array.isArray(data) ? data : [];
            const results = [];
            const seen = new Set();
            for (const m of list) {
                const parsed = this.browseToItem(m);
                if (!parsed)
                    continue;
                if (seen.has(parsed.mangaId))
                    continue;
                seen.add(parsed.mangaId);
                results.push({
                    mangaId: parsed.mangaId,
                    imageUrl: parsed.imageUrl,
                    title: parsed.title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            }
            return { items: results, metadata: undefined };
        }
        // Filtered library browse (paged). A genre may be carried through from a
        // genres discover item via query.metadata.
        const pageMeta = metadata;
        const page = pageMeta?.page ?? 1;
        const genre = query.metadata?.genre;
        const json = await this.fetchLibrary({
            page,
            orderby: "date",
            includeGenres: genre ? [genre] : undefined,
        });
        const data = json.series?.data ?? [];
        const results = [];
        const seen = new Set();
        for (const m of data) {
            const parsed = this.browseToItem(m);
            if (!parsed)
                continue;
            if (seen.has(parsed.mangaId))
                continue;
            seen.add(parsed.mangaId);
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const current = json.series?.meta?.current_page ?? page;
        const last = json.series?.meta?.last_page ?? page;
        return {
            items: results,
            metadata: current < last ? { page: page + 1 } : undefined,
        };
    }
    browseToItem(m) {
        const slug = m.slug;
        if (!slug)
            return undefined;
        const title = m.title || m.name || slug;
        const imageUrl = this.createThumbnailUrl(m.cover_image ?? m.image ?? null);
        return { mangaId: this.toSafeId(slug), imageUrl, title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const json = await this.fetchSerie(slug);
        const data = json.props?.serie;
        const title = data?.title || data?.name || slug;
        const thumbnailUrl = this.createThumbnailUrl(data?.cover_image ?? data?.image ?? null);
        const descriptionParts = [];
        if (data?.description)
            descriptionParts.push(data.description.trim());
        if (data?.release_year != null) {
            descriptionParts.push(`Release year: ${data.release_year}`);
        }
        if (data?.name_alternative) {
            descriptionParts.push(`Alternative names: ${data.name_alternative}`);
        }
        const synopsis = descriptionParts.join("\n\n").trim();
        const genreNames = [];
        if (data?.type?.name)
            genreNames.push(data.type.name);
        for (const g of data?.genres ?? []) {
            if (g.name)
                genreNames.push(g.name);
        }
        const tagGroups = [];
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
        const secondaryTitles = [];
        if (data?.name_alternative)
            secondaryTitles.push(data.name_alternative);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles,
                thumbnailUrl,
                author: data?.author ?? undefined,
                artist: data?.artist ?? undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(data?.status ?? ""),
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
        const json = await this.fetchSerie(slug);
        const data = json.props?.serie;
        const rawChapters = data?.chapters ?? [];
        const serieSlug = data?.slug || slug;
        const chapters = [];
        const seen = new Set();
        for (const c of rawChapters) {
            if (!c.slug)
                continue;
            const chapterPath = `serie/${serieSlug}/chapter/${c.slug}`;
            const chapterId = this.toSafeId(chapterPath);
            if (seen.has(chapterId))
                continue;
            seen.add(chapterId);
            const name = `${c.isPremium ? "🔒 " : ""}${c.title ?? c.slug}`;
            chapters.push({
                chapterId,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(c.title ?? c.slug),
                publishDate: this.parseDate(c.createdAt),
                langCode: "🇬🇧",
            });
        }
        // Upstream reverses the API order so newest chapters appear first.
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const path = this.safeDecode(chapter.chapterId);
        const url = `${BASE_URL}/${path.replace(/^\/+/, "")}`;
        const json = await this.fetchInertia(url);
        const props = json.props;
        const pageCount = props?.page_count ?? 0;
        const serieSlug = props?.data?.serie?.slug ?? "";
        const chapterSlug = props?.data?.slug ?? "";
        const serverPubkeyB64 = props?.server_pubkey ?? "";
        const chapterToken = props?.chapter_token ?? "";
        // Perform X25519 handshake to derive shared secret
        if (serverPubkeyB64 && chapterToken) {
            const serverPub = base64Decode(serverPubkeyB64);
            if (serverPub.length === 32) {
                const privateKey = getRandomBytes(32);
                const clientPub = x25519PublicKey(privateKey);
                const shared = x25519ScalarMult(privateKey, serverPub);
                // Clear private key
                privateKey.fill(0);
                chapterSessions.set(sessionKey(serieSlug, chapterSlug), {
                    chapterToken,
                    sharedSecret: shared,
                    clientPubkeyB64: base64Encode(clientPub),
                });
            }
        }
        // Construct bare page URLs. The actual HMAC signing (token/ts/nonce/sig)
        // and X-Client-Pubkey header are added per-request in the interceptor so
        // that scroll-back re-fetches always carry a fresh, non-stale signature.
        const pages = [];
        if (serieSlug && chapterSlug) {
            for (let i = 1; i <= pageCount; i++) {
                pages.push(`${BASE_URL}/serie/${serieSlug}/chapter/${chapterSlug}/page/${i}`);
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
    // API request helpers
    // ----------------------------------------------------------------
    async fetchLibrary(opts) {
        const params = [];
        if (opts.page > 1)
            params.push(`page=${opts.page}`);
        if (opts.includeGenres && opts.includeGenres.length > 0) {
            params.push(`include_genres=${encodeURIComponent(opts.includeGenres.join(","))}`);
        }
        if (opts.includeTypes && opts.includeTypes.length > 0) {
            params.push(`include_types=${encodeURIComponent(opts.includeTypes.join(","))}`);
        }
        if (opts.status && opts.status.length > 0) {
            params.push(`status=${encodeURIComponent(opts.status.join(","))}`);
        }
        params.push(`orderby=${encodeURIComponent(opts.orderby)}`);
        if (opts.order)
            params.push(`order=${encodeURIComponent(opts.order)}`);
        const query = params.length > 0 ? `?${params.join("&")}` : "";
        const url = `${BASE_URL}/library${query}`;
        return this.fetchJson(url);
    }
    async fetchSerie(slug) {
        const cleanSlug = slug.replace(/^\/+/, "").replace(/^serie\//, "");
        const url = `${BASE_URL}/serie/${cleanSlug}`;
        return this.fetchInertia(url);
    }
    // Plain JSON endpoints (library / search). These require the XSRF-TOKEN
    // cookie which the cookie interceptor persists once the home page is hit.
    async fetchJson(url) {
        await this.ensureBootstrap();
        const xsrf = this.xsrfTokenHeader();
        const headers = {
            accept: "application/json",
            "x-requested-with": "XMLHttpRequest",
        };
        if (xsrf)
            headers["x-xsrf-token"] = xsrf;
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
            headers,
        });
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
    // Inertia page-data endpoints (serie details / chapter page list). These
    // require the X-Inertia headers and version so the server returns JSON.
    async fetchInertia(url) {
        await this.ensureBootstrap();
        const xsrf = this.xsrfTokenHeader();
        const headers = {
            accept: "application/json",
            "x-requested-with": "XMLHttpRequest",
            "x-inertia": "true",
        };
        if (this.inertiaVersion)
            headers["x-inertia-version"] = this.inertiaVersion;
        if (xsrf)
            headers["x-xsrf-token"] = xsrf;
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
            headers,
        });
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
    // Load the home page once to obtain the XSRF-TOKEN cookie and the Inertia
    // version embedded in #app[data-page].
    async ensureBootstrap() {
        if (this.inertiaVersion !== undefined && this.xsrfTokenHeader())
            return;
        const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });
        const dataPage = $("#app").first().attr("data-page") || "";
        if (dataPage) {
            try {
                const parsed = JSON.parse(dataPage);
                if (parsed.version)
                    this.inertiaVersion = parsed.version;
            }
            catch {
                // ignore malformed data-page payloads
            }
        }
        if (this.inertiaVersion === undefined)
            this.inertiaVersion = "";
    }
    xsrfTokenHeader() {
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            if (cookie.name === "XSRF-TOKEN" && cookie.value) {
                return this.safeDecode(cookie.value);
            }
        }
        return undefined;
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    createThumbnailUrl(imagePath) {
        if (!imagePath)
            return "";
        return this.absoluteUrl(imagePath);
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        const clean = slug.replace(/^\/+/, "").replace(/^serie\//, "");
        return `${BASE_URL}/serie/${clean}`;
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
    parseDate(raw) {
        if (!raw)
            return new Date(0);
        const trimmed = raw.split(".")[0];
        const ms = Date.parse(`${trimmed}Z`);
        if (!Number.isNaN(ms))
            return new Date(ms);
        const ms2 = Date.parse(trimmed);
        return Number.isNaN(ms2) ? new Date(0) : new Date(ms2);
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
        if (s.includes("ongoing") || s.includes("upcoming"))
            return "Ongoing";
        if (s.includes("finished"))
            return "Completed";
        if (s.includes("dropped"))
            return "Cancelled";
        if (s.includes("onhold") || s.includes("hiatus"))
            return "Hiatus";
        return "Unknown";
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
export const TheBlank = new TheBlankExtension();
