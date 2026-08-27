import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
// ---------------------------------------------------------------------------
// Mangamo is a Firebase/Firestore-backed JSON API (no public HTML browsing).
// We port the upstream keiyoushi extension: an anonymous Firebase user is
// created, exchanged for a Google identity-toolkit idToken, and that bearer
// token authorises Firestore REST queries (Series / chapters collections) and
// the cloud-function page endpoint. Paid/subscriber chapters return 401 from
// the page endpoint; we expose everything publicly readable.
// ---------------------------------------------------------------------------
const BASE_URL = "https://www.mangamo.com";
const FIREBASE_API_KEY = "AIzaSyCU00GBJ4BPSK5owyaXvHZIXwMJ5Rq5F8c";
const FIREBASE_FUNCTION_BASE_PATH = "https://us-central1-mangamoapp1.cloudfunctions.net/api";
const FIRESTORE_API_BASE_PATH = "https://firestore.googleapis.com/v1/projects/mangamoapp1/databases/(default)/documents";
const SERIES_QUERY_PARAM = "series";
const CHAPTER_QUERY_PARAM = "chapter";
const BROWSE_PAGE_SIZE = 50;
const SERIES_REQUIRED_FIELDS = [
    "id",
    "name",
    "name_lowercase",
    "description",
    "authors",
    "genres",
    "ongoing",
    "releaseStatusTag",
    "titleArt",
];
class MangamoInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json, text/plain, */*",
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
export class MangamoExtension {
    requestManager = new MangamoInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 3,
        bufferInterval: 1,
        ignoreImages: true,
    });
    // Cached Firebase auth state.
    userToken = "";
    idToken = "";
    refreshToken = "";
    expirationTime = 0;
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    // ----------------------------------------------------------------
    // Firebase authentication
    // ----------------------------------------------------------------
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 401) {
            throw new Error("You don't have access to this content");
        }
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
    async createAnonymousUserToken() {
        const res = await this.fetchJson({
            url: `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ returnSecureToken: true }),
        });
        return res.localId;
    }
    async obtainInitialIdToken() {
        if (!this.userToken) {
            this.userToken = await this.createAnonymousUserToken();
        }
        const login = await this.fetchJson({
            url: `${FIREBASE_FUNCTION_BASE_PATH}/v3/login`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                purchaserInfo: { originalAppUserId: this.userToken },
            }),
        });
        const tokenInfo = await this.fetchJson({
            url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: login.accessToken, returnSecureToken: true }),
        });
        this.idToken = tokenInfo.idToken;
        this.refreshToken = tokenInfo.refreshToken;
        this.expireIn(Number(tokenInfo.expiresIn));
    }
    expireIn(seconds) {
        this.expirationTime = Date.now() + (seconds - 1) * 1000;
    }
    async refreshIfNecessary() {
        if (Date.now() <= this.expirationTime)
            return;
        const [response, data] = await Application.scheduleRequest({
            url: `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: `grant_type=refresh_token&refresh_token=${this.refreshToken}`,
        });
        if (response.status === 200) {
            const tokenInfo = JSON.parse(Application.arrayBufferToUTF8String(data));
            this.idToken = tokenInfo.id_token;
            this.refreshToken = tokenInfo.refresh_token;
            this.expireIn(Number(tokenInfo.expires_in));
        }
        else {
            await this.obtainInitialIdToken();
        }
    }
    async getIdToken() {
        if (!this.idToken) {
            await this.obtainInitialIdToken();
        }
        else {
            await this.refreshIfNecessary();
        }
        return this.idToken;
    }
    // ----------------------------------------------------------------
    // Firestore query helpers
    // ----------------------------------------------------------------
    async getDocument(path, fields) {
        const params = fields
            .map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`)
            .join("&");
        const url = `${FIRESTORE_API_BASE_PATH}/${path}${params ? `?${params}` : ""}`;
        const token = await this.getIdToken();
        const raw = await this.fetchJson({
            url,
            method: "GET",
            headers: { authorization: `Bearer ${token}` },
        });
        return this.reduceFieldsObject(raw["fields"] ?? {});
    }
    async runQuery(fullPath, opts) {
        const pivot = fullPath.lastIndexOf("/");
        const path = pivot === -1 ? "" : fullPath.substring(0, pivot);
        const collectionId = pivot === -1 ? fullPath : fullPath.substring(pivot + 1);
        const structuredQuery = {
            from: [{ collectionId }],
        };
        if (opts.fields && opts.fields.length > 0) {
            structuredQuery["select"] = {
                fields: opts.fields.map((f) => ({ fieldPath: f })),
            };
        }
        if (opts.filter)
            structuredQuery["where"] = opts.filter;
        if (opts.orderBy)
            structuredQuery["orderBy"] = opts.orderBy;
        if (opts.offset !== undefined)
            structuredQuery["offset"] = opts.offset;
        if (opts.limit !== undefined)
            structuredQuery["limit"] = opts.limit;
        const url = `${FIRESTORE_API_BASE_PATH}/${path}:runQuery`;
        const token = await this.getIdToken();
        const raw = await this.fetchJson({
            url,
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ structuredQuery }),
        });
        const results = [];
        for (const entry of raw) {
            if (!entry || !entry.document || !entry.document.fields)
                continue;
            results.push(this.reduceFieldsObject(entry.document.fields));
        }
        return results;
    }
    // Firestore wraps every value in a typed container, e.g.
    // {"stringValue":"x"}, {"integerValue":"3"}, {"arrayValue":{"values":[...]}},
    // {"mapValue":{"fields":{...}}}. Reduce that to plain JS values.
    reduceFieldsObject(fields) {
        const out = {};
        for (const key of Object.keys(fields)) {
            out[key] = this.reduceField(fields[key]);
        }
        return out;
    }
    reduceField(element) {
        if (element === null || typeof element !== "object")
            return element;
        const obj = element;
        const keys = Object.keys(obj);
        if (keys.length === 0)
            return null;
        const key = keys[0];
        const value = obj[key];
        switch (key) {
            case "arrayValue": {
                const arr = value?.values ?? [];
                return arr.map((v) => this.reduceField(v));
            }
            case "mapValue": {
                const inner = value?.fields ?? {};
                return this.reduceFieldsObject(inner);
            }
            case "integerValue":
            case "doubleValue":
                return Number(value);
            case "booleanValue":
                return Boolean(value);
            case "nullValue":
                return null;
            default:
                return value;
        }
    }
    // Firestore structured-query filter builders.
    fieldFilter(field, op, value) {
        let valueTerm;
        if (value === null) {
            valueTerm = { nullValue: null };
        }
        else if (typeof value === "boolean") {
            valueTerm = { booleanValue: value };
        }
        else if (typeof value === "number") {
            valueTerm = Number.isInteger(value)
                ? { integerValue: value }
                : { doubleValue: value };
        }
        else {
            valueTerm = { stringValue: String(value) };
        }
        return {
            fieldFilter: { op, field: { fieldPath: field }, value: valueTerm },
        };
    }
    andFilter(...filters) {
        return { compositeFilter: { op: "AND", filters } };
    }
    // ----------------------------------------------------------------
    // Series mapping
    // ----------------------------------------------------------------
    seriesUrl(series) {
        const lowercaseHyphenated = (series.name_lowercase ?? "").replace(/ /g, "-");
        return `/catalog/${encodeURIComponent(lowercaseHyphenated)}?${SERIES_QUERY_PARAM}=${series.id}`;
    }
    parseStatus(series) {
        switch (series.releaseStatusTag) {
            case "Ongoing":
                return "Ongoing";
            case "series-complete":
            case "Completed":
                return "Completed";
            case "Paused":
                return "Hiatus";
            default:
                return series.ongoing === true ? "Ongoing" : "Unknown";
        }
    }
    searchItemFromSeries(series) {
        if (series.id === undefined || !series.name)
            return null;
        return {
            mangaId: this.seriesUrl(series),
            imageUrl: series.titleArt ?? "",
            title: series.name,
            subtitle: undefined,
            metadata: undefined,
        };
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
        let series;
        if (section.id === "latest") {
            series = await this.runQuery("Series", {
                fields: [...SERIES_REQUIRED_FIELDS, "enabled"],
                orderBy: [
                    { direction: "DESCENDING", field: { fieldPath: "updatedAt" } },
                ],
                offset: (page - 1) * BROWSE_PAGE_SIZE,
                limit: BROWSE_PAGE_SIZE,
            });
            series = series.filter((s) => s.enabled === true);
        }
        else {
            series = await this.runQuery("Series", {
                fields: SERIES_REQUIRED_FIELDS,
                filter: this.andFilter(this.fieldFilter("enabled", "EQUAL", true)),
                offset: (page - 1) * BROWSE_PAGE_SIZE,
                limit: BROWSE_PAGE_SIZE,
            });
        }
        const items = [];
        for (const s of series) {
            const item = this.searchItemFromSeries(s);
            if (!item)
                continue;
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: item.mangaId,
                imageUrl: item.imageUrl,
                title: item.title,
                metadata: undefined,
            });
        }
        const hasNext = series.length >= BROWSE_PAGE_SIZE;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim().toLowerCase();
        const series = await this.runQuery("Series", {
            fields: SERIES_REQUIRED_FIELDS,
            filter: this.andFilter(this.fieldFilter("enabled", "EQUAL", true), this.fieldFilter("name_lowercase", "GREATER_THAN_OR_EQUAL", titleQuery), this.fieldFilter("name_lowercase", "LESS_THAN_OR_EQUAL", titleQuery + "")),
            offset: (page - 1) * BROWSE_PAGE_SIZE,
            limit: BROWSE_PAGE_SIZE,
        });
        const items = [];
        for (const s of series) {
            const item = this.searchItemFromSeries(s);
            if (item)
                items.push(item);
        }
        const hasNext = series.length >= BROWSE_PAGE_SIZE;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const seriesId = this.seriesIdFromMangaId(mangaId);
        const dto = await this.getDocument(`Series/${seriesId}`, SERIES_REQUIRED_FIELDS);
        const tagGroups = [];
        const genres = (dto.genres ?? [])
            .map((g) => g?.name ?? "")
            .filter((n) => n.length > 0);
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
        const author = (dto.authors ?? [])
            .map((a) => a?.name ?? "")
            .filter((n) => n.length > 0)
            .join(", ");
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: dto.name ?? this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl: dto.titleArt ?? "",
                author: author || undefined,
                artist: author || undefined,
                synopsis: dto.description ?? "",
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(dto),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const seriesId = this.seriesIdFromMangaId(sourceManga.mangaId);
        const series = await this.getDocument(`Series/${seriesId}`, [
            "maxFreeChapterNumber",
            "maxMeteredReadingChapterNumber",
            "onlyTransactional",
        ]);
        const chapterDtos = await this.runQuery(`Series/${seriesId}/chapters`, {
            fields: [
                "enabled",
                "id",
                "seriesId",
                "chapterNumber",
                "name",
                "createdAt",
                "onlyTransactional",
            ],
            orderBy: [
                { direction: "DESCENDING", field: { fieldPath: "chapterNumber" } },
            ],
        });
        const maxFree = series.maxFreeChapterNumber ?? 0;
        const maxMetered = series.maxMeteredReadingChapterNumber ?? 0;
        const chapters = [];
        for (const chapter of chapterDtos) {
            if (chapter.enabled !== true)
                continue;
            const chapNum = chapter.chapterNumber ?? 0;
            const isFree = chapNum <= maxFree;
            const isMetered = chapNum <= maxMetered;
            const isCoin = chapter.onlyTransactional === true ||
                (series.onlyTransactional === true && !isFree);
            let suffix = "";
            if (isCoin) {
                suffix = " 🪙"; // coin emoji
            }
            else if (isFree) {
                suffix = "";
            }
            else if (isMetered) {
                suffix = " 🕒"; // metered (clock)
            }
            else {
                suffix = " 🔒"; // subscriber lock
            }
            chapters.push({
                chapterId: this.chapterIdFor(chapter.seriesId, chapter.id),
                sourceManga,
                title: (chapter.name ?? "") + suffix,
                volume: 0,
                chapNum,
                publishDate: chapter.createdAt
                    ? new Date(chapter.createdAt)
                    : new Date(0),
                langCode: "🇬🇧",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const { seriesId, chapterId } = this.parseChapterId(chapter.chapterId);
        const token = await this.getIdToken();
        const data = await this.fetchJson({
            url: `${FIREBASE_FUNCTION_BASE_PATH}/page/${seriesId}/${chapterId}`,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idToken: token }),
        });
        const pages = data
            .slice()
            .sort((a, b) => a.pageNumber - b.pageNumber)
            .map((p) => p.uri)
            .filter((u) => !!u);
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
    // Id / URL helpers
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    // mangaId is the relative catalog url e.g. "/catalog/foo?series=123".
    seriesIdFromMangaId(mangaId) {
        const slug = this.safeDecode(mangaId);
        const m = slug.match(/[?&]series=(\d+)/);
        return m ? m[1] : "";
    }
    // chapterId encodes both ids: "?series=1&chapter=2".
    chapterIdFor(seriesId, chapterId) {
        return `?${SERIES_QUERY_PARAM}=${seriesId ?? ""}&${CHAPTER_QUERY_PARAM}=${chapterId ?? ""}`;
    }
    parseChapterId(id) {
        const decoded = this.safeDecode(id);
        const s = decoded.match(/[?&]series=(\d+)/);
        const c = decoded.match(/[?&]chapter=(\d+)/);
        return {
            seriesId: s ? s[1] : "",
            chapterId: c ? c[1] : "",
        };
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
}
export const Mangamo = new MangamoExtension();
