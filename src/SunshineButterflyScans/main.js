import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://wings.sbs";
const CDN_URL = `${BASE_URL}/images/projcoverjpeg/`;
const CHAPTERS_JSON = `${BASE_URL}/json/chapters.json`;
// Google Drive / Imgur page providers (mirrors upstream Kotlin companion).
const GOOGLE_DRIVE_FIRST = 'https://www.googleapis.com/drive/v3/files?q="';
const GOOGLE_DRIVE_SECOND = '"+in+parents&key=AIzaSyDDWjOHN1UPcafkwyJLO7fX1gmVyntIozs&orderBy=name_natural&fields=files(id,name,imageMediaMetadata)&pageSize=250';
const IMGUR_FIRST = "https://api.imgur.com/3/album/";
const IMGUR_SECOND = "/images";
const IMGUR_BEARER = "84155230e6a2d98eaea1cee48d97e6ecff0f6c12";
// AES-CBC key/iv (Base64-encoded in upstream), used to decrypt AlbumID.
const KEY_B64 = "YX+1nM4KgfaYwNE3/MPcTg==";
const IV_B64 = "279GjT2Xu9LZBkI4zLzIAg==";
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
// Hosts that serve the actual page images. Faithful to upstream's
// imageRequest(): these need an image-flavoured Accept header and a
// host-matched Host header, and must NOT carry the wings.sbs API headers
// (Origin / Authorization), or the CDNs reject the hotlink.
const IMAGE_HOSTS = ["lh3.googleusercontent.com", "i.imgur.com", "imgur.com"];
function hostOf(url) {
    try {
        return url.replace(/^https?:\/\//, "").split("/")[0]?.split("?")[0] ?? "";
    }
    catch {
        return "";
    }
}
class SunshineButterflyScansInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        const host = hostOf(request.url);
        const userAgent = await Application.getDefaultUserAgent();
        if (IMAGE_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
            // Mirror upstream imageRequest(): image Accept + host header, with the
            // site referer (so Google Drive / Imgur serve the bytes), but none of
            // the API-only Origin / Authorization headers.
            request.headers = {
                ...request.headers,
                referer: `${BASE_URL}/`,
                "user-agent": userAgent,
                accept: "image/avif,image/webp,*/*",
                host,
            };
            return request;
        }
        // API hosts (wings.sbs JSON, googleapis, api.imgur.com) and everything
        // else: keep the wildcard Accept and site referer. Per-call headers set
        // in getChapterDetails (Origin / Authorization / Host) are preserved.
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            "user-agent": userAgent,
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
export class SunshineButterflyScansExtension {
    requestManager = new SunshineButterflyScansInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 2,
        bufferInterval: 1,
        ignoreImages: true,
    });
    // Cached grouped/sorted chapter data (groups of entries per series,
    // each group sorted by chapter number descending).
    cachedGroups;
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    // ----------------------------------------------------------------
    // Data loading
    // ----------------------------------------------------------------
    async getGroups() {
        if (this.cachedGroups)
            return this.cachedGroups;
        const [response, data] = await Application.scheduleRequest({
            url: CHAPTERS_JSON,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const entries = JSON.parse(Application.arrayBufferToUTF8String(data));
        const bySeries = new Map();
        for (const entry of entries) {
            const arr = bySeries.get(entry.series) ?? [];
            arr.push(entry);
            bySeries.set(entry.series, arr);
        }
        const groups = Array.from(bySeries.values()).map((arr) => arr.slice().sort((a, b) => b.num - a.num));
        this.cachedGroups = groups;
        return groups;
    }
    timestampValue(entry) {
        const v = parseInt(entry.timestamp, 10);
        return Number.isNaN(v) ? Number.MAX_SAFE_INTEGER : v;
    }
    searchItemFromEntry(entry) {
        return {
            mangaId: this.toSafeId(entry.projectname),
            imageUrl: CDN_URL + entry.projectthumb,
            title: entry.series,
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
                title: "All Projects",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, _metadata) {
        const groups = await this.getGroups();
        const heads = groups.map((g) => g[0]);
        let ordered;
        if (section.id === "latest") {
            ordered = heads
                .slice()
                .sort((a, b) => this.timestampValue(b) - this.timestampValue(a));
        }
        else {
            ordered = heads
                .slice()
                .sort((a, b) => a.series.localeCompare(b.series));
        }
        const items = ordered.map((entry) => ({
            type: section.id === "latest"
                ? "simpleCarouselItem"
                : "featuredCarouselItem",
            mangaId: this.toSafeId(entry.projectname),
            imageUrl: CDN_URL + entry.projectthumb,
            title: entry.series,
            metadata: undefined,
        }));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const groups = await this.getGroups();
        const titleQuery = (query.title || "").trim().toLowerCase();
        const heads = groups
            .map((g) => g[0])
            .sort((a, b) => a.series.localeCompare(b.series));
        const filtered = heads.filter((entry) => titleQuery === "" || entry.series.toLowerCase().includes(titleQuery));
        const items = filtered.map((entry) => this.searchItemFromEntry(entry));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const projectName = this.safeDecode(mangaId);
        const groups = await this.getGroups();
        const group = groups.find((g) => g[0].projectname === projectName);
        const entry = group?.[0];
        if (!entry) {
            return {
                mangaId,
                mangaInfo: {
                    primaryTitle: projectName,
                    secondaryTitles: [],
                    thumbnailUrl: "",
                    synopsis: "",
                    contentRating: ContentRating.MATURE,
                    status: "Unknown",
                    tagGroups: [],
                    shareUrl: this.mangaUrl(mangaId),
                },
            };
        }
        let synopsis = entry.projectdesc.trim();
        if (entry.projectaltname.length > 0) {
            synopsis += `\n\nAlternative name: ${entry.projectaltname}`;
        }
        const tagGroups = [];
        const tags = entry.projecttags
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
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
                primaryTitle: entry.series,
                secondaryTitles: entry.projectaltname.length > 0 ? [entry.projectaltname] : [],
                thumbnailUrl: CDN_URL + entry.projectthumb,
                author: entry.projectauthor.length > 0 ? entry.projectauthor : undefined,
                artist: entry.projectartist.length > 0 ? entry.projectartist : undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(entry.projectstatus),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const projectName = this.safeDecode(sourceManga.mangaId);
        const groups = await this.getGroups();
        const group = groups.find((g) => g[0].projectname === projectName) ?? [];
        return group.map((entry) => ({
            chapterId: this.toSafeId(`${entry.projectname}&num=${entry.num}`),
            sourceManga,
            title: entry.chname,
            volume: 0,
            chapNum: entry.num,
            publishDate: this.parseDate(entry.timestamp),
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const key = this.safeDecode(chapter.chapterId); // "projectName&num=N"
        const groups = await this.getGroups();
        let target;
        for (const group of groups) {
            for (const entry of group) {
                if (`${entry.projectname}&num=${entry.num}` === key) {
                    target = entry;
                    break;
                }
            }
            if (target)
                break;
        }
        const pages = [];
        if (!target) {
            return {
                id: chapter.chapterId,
                mangaId: chapter.sourceManga.mangaId,
                pages,
            };
        }
        const decrypted = await this.decryptAlbumId(target.AlbumID);
        if (decrypted.length > 10) {
            // Google Drive folder. Mirror upstream pageListRequest(): Host header
            // matched to the API host + Origin set to the site.
            const url = `${GOOGLE_DRIVE_FIRST}${decrypted}${GOOGLE_DRIVE_SECOND}`;
            const [response, data] = await Application.scheduleRequest({
                url,
                method: "GET",
                headers: {
                    accept: "*/*",
                    host: "www.googleapis.com",
                    origin: BASE_URL,
                },
            });
            if (response.status === 404) {
                throw new Error("Content not found");
            }
            const parsed = this.parseGoogleDrive(Application.arrayBufferToUTF8String(data));
            const files = parsed
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
            for (const file of files) {
                const width = file.imageMediaMetadata?.width ?? 0;
                pages.push(`https://lh3.googleusercontent.com/d/${file.id}=w${width}`);
            }
        }
        else {
            // Imgur album. Mirror upstream: Host header for the Imgur API host +
            // Origin, and the Imgur client Bearer token (Imgur-only).
            const url = `${IMGUR_FIRST}${decrypted}${IMGUR_SECOND}`;
            const [response, data] = await Application.scheduleRequest({
                url,
                method: "GET",
                headers: {
                    accept: "*/*",
                    host: "api.imgur.com",
                    origin: BASE_URL,
                    authorization: `Bearer ${IMGUR_BEARER}`,
                },
            });
            if (response.status === 404) {
                throw new Error("Content not found");
            }
            const parsed = this.parseImgur(Application.arrayBufferToUTF8String(data));
            for (const item of parsed) {
                pages.push(item.link);
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
        const projectName = this.safeDecode(mangaId);
        if (projectName.startsWith("http"))
            return projectName;
        return `${BASE_URL}/projects?n=${encodeURIComponent(projectName)}`;
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
    parseStatus(status) {
        switch (status) {
            case "current":
                return "Ongoing";
            case "complete":
                return "Completed";
            case "dropped":
                return "Cancelled";
            case "licensed":
                return "Unknown";
            default:
                return "Unknown";
        }
    }
    parseDate(timestamp) {
        const v = parseInt(timestamp, 10);
        if (Number.isNaN(v) || v <= 0)
            return new Date(0);
        return new Date(v * 1000);
    }
    // Decode a Base64 string into raw bytes.
    base64ToBytes(b64) {
        const decoded = Application.base64Decode(b64);
        if (typeof decoded === "string") {
            const out = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++)
                out[i] = decoded.charCodeAt(i);
            return out;
        }
        return new Uint8Array(decoded);
    }
    bufferOf(bytes) {
        const out = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(out).set(bytes);
        return out;
    }
    // AES-CBC decrypt the Base64 AlbumID using the hardcoded key/iv and
    // return the resulting UTF-8 plaintext (a Google Drive folder id or
    // Imgur album hash). Mirrors keiyoushi CryptoAES.decrypt (PKCS7).
    async decryptAlbumId(albumId) {
        const key = this.base64ToBytes(KEY_B64);
        const iv = this.base64ToBytes(IV_B64);
        const ciphertext = this.base64ToBytes(albumId);
        const subtle = globalThis.crypto
            .subtle;
        const cryptoKey = await subtle.importKey("raw", this.bufferOf(key), { name: "AES-CBC" }, false, ["decrypt"]);
        const decrypted = new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv: this.bufferOf(iv) }, cryptoKey, this.bufferOf(ciphertext)));
        return Application.arrayBufferToUTF8String(this.bufferOf(decrypted)).trim();
    }
    // Parse a Google Drive files-list response from raw JSON text.
    parseGoogleDrive(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            return [];
        }
        if (!isRecord(parsed) || !Array.isArray(parsed.files))
            return [];
        const out = [];
        for (const raw of parsed.files) {
            if (!isRecord(raw))
                continue;
            const id = raw.id;
            const name = raw.name;
            if (typeof id !== "string" || typeof name !== "string")
                continue;
            let width;
            const meta = raw.imageMediaMetadata;
            if (isRecord(meta) && typeof meta.width === "number") {
                width = meta.width;
            }
            out.push({
                id,
                name,
                imageMediaMetadata: width === undefined ? undefined : { width },
            });
        }
        return out;
    }
    // Parse an Imgur album-images response from raw JSON text.
    parseImgur(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            return [];
        }
        if (!isRecord(parsed) || !Array.isArray(parsed.data))
            return [];
        const out = [];
        for (const raw of parsed.data) {
            if (!isRecord(raw))
                continue;
            if (typeof raw.link === "string")
                out.push({ link: raw.link });
        }
        return out;
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
export const SunshineButterflyScans = new SunshineButterflyScansExtension();
