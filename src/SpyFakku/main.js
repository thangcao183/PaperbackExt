import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://hentalk.pw";
const API_URL = `${BASE_URL}/api`;
const IMAGE_URL = `${BASE_URL}/image`;
class SpyFakkuInterceptor extends PaperbackInterceptor {
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
export class SpyFakkuExtension {
    requestManager = new SpyFakkuInterceptor("main");
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
                title: "Latest",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "released_at" : "created_at";
        const url = `${API_URL}/library?sort=${sort}&page=${page}`;
        const lib = await this.fetchJson({ url, method: "GET" });
        const items = lib.archives.map((archive) => ({
            type: section.id === "popular"
                ? "featuredCarouselItem"
                : "simpleCarouselItem",
            mangaId: this.toMangaId(archive),
            imageUrl: this.coverUrl(archive.hash, archive.thumbnail),
            title: archive.title,
            metadata: undefined,
        }));
        const hasNextPage = lib.page * lib.limit < lib.total;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const params = [];
        params.push(`q=${encodeURIComponent(titleQuery)}`);
        params.push(`page=${page}`);
        const url = `${API_URL}/library?${params.join("&")}`;
        const lib = await this.fetchJson({ url, method: "GET" });
        const items = lib.archives.map((archive) => ({
            mangaId: this.toMangaId(archive),
            imageUrl: this.coverUrl(archive.hash, archive.thumbnail),
            title: archive.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = lib.page * lib.limit < lib.total;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const id = this.parseId(mangaId);
        const url = `${API_URL}/g/${id}`;
        const add = await this.fetchJson({ url, method: "GET" });
        const tags = add.tags ?? [];
        const byNamespace = (ns) => tags.filter((t) => t.namespace === ns);
        const names = (ns) => byNamespace(ns)
            .map((t) => t.name)
            .join(", ");
        const circles = names("circle");
        const artists = names("artist");
        const author = circles || artists;
        const artist = artists;
        const tagGroups = [];
        const genreTags = byNamespace("tag");
        if (genreTags.length > 0) {
            tagGroups.push({
                id: "tags",
                title: "Tags",
                tags: genreTags.map((t) => ({
                    id: t.name.toLowerCase().replace(/\s+/g, "-"),
                    title: t.name,
                })),
            });
        }
        const synopsis = this.buildSynopsis(add);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: this.titleFromId(mangaId),
                secondaryTitles: [],
                thumbnailUrl: this.coverUrl(add.hash, add.thumbnail),
                author: author || undefined,
                artist: artist || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: "Completed",
                tagGroups,
                shareUrl: this.shareUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const id = this.parseId(sourceManga.mangaId);
        const url = `${API_URL}/g/${id}`;
        const add = await this.fetchJson({ url, method: "GET" });
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title: "Chapter",
                volume: 0,
                chapNum: 1,
                publishDate: this.parseDate(add.released_at),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const mangaId = chapter.sourceManga.mangaId;
        let hash = this.parseHash(mangaId);
        let pageCount = this.parsePages(mangaId);
        if (!hash || !pageCount) {
            const id = this.parseId(mangaId);
            const url = `${API_URL}/g/${id}`;
            const add = await this.fetchJson({ url, method: "GET" });
            hash = add.hash;
            pageCount = add.pages;
        }
        const pages = [];
        for (let i = 1; i <= pageCount; i++) {
            pages.push(`${IMAGE_URL}/${hash}/${i}`);
        }
        return {
            id: chapter.chapterId,
            mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        return this.shareUrl(mangaId);
    }
    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    // mangaId encodes "g/<id>?<pages>&hash=<hash>&title=<title>"
    toMangaId(archive) {
        const slug = `g/${archive.id}?${archive.pages}&hash=${archive.hash}&title=${encodeURIComponent(archive.title)}`;
        return this.toSafeId(slug);
    }
    parseId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const m = decoded.match(/g\/(\d+)/);
        return m ? m[1] : decoded.replace(/^\/+/, "").replace(/^g\//, "").replace(/[?#].*$/, "");
    }
    parseHash(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const m = decoded.match(/hash=([^&]+)/);
        return m ? m[1] : "";
    }
    parsePages(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const m = decoded.match(/\?(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }
    titleFromId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const m = decoded.match(/title=([^&]+)/);
        if (m)
            return this.safeDecode(m[1]);
        return `Gallery ${this.parseId(mangaId)}`;
    }
    coverUrl(hash, thumbnail) {
        return `${IMAGE_URL}/${hash}/${thumbnail}?type=cover`;
    }
    shareUrl(mangaId) {
        return `${BASE_URL}/g/${this.parseId(mangaId)}`;
    }
    buildSynopsis(add) {
        const tags = add.tags ?? [];
        const join = (ns) => tags
            .filter((t) => t.namespace === ns)
            .map((t) => t.name)
            .join(", ");
        const parts = [];
        if (add.description)
            parts.push(add.description);
        const circles = join("circle");
        if (circles)
            parts.push(`Circles: ${circles}`);
        const publishers = join("publisher");
        if (publishers)
            parts.push(`Publishers: ${publishers}`);
        const magazines = join("magazine");
        if (magazines)
            parts.push(`Magazines: ${magazines}`);
        const events = join("event");
        if (events)
            parts.push(`Events: ${events}`);
        const parodies = join("parody");
        if (parodies)
            parts.push(`Parodies: ${parodies}`);
        parts.push(`Pages: ${add.pages}`);
        parts.push(`Size: ${this.formatSize(add.size)}`);
        return parts.join("\n");
    }
    formatSize(size) {
        if (size >= 300 * 1000 * 1000) {
            return `${(size / (1000.0 * 1000.0 * 1000.0)).toFixed(2)} GB`;
        }
        if (size >= 100 * 1000) {
            return `${(size / (1000.0 * 1000.0)).toFixed(2)} MB`;
        }
        if (size >= 1000) {
            return `${(size / 1000.0).toFixed(2)} kB`;
        }
        return `${size} B`;
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
        return isNaN(d.getTime()) ? new Date(0) : d;
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const jsonStr = Application.arrayBufferToUTF8String(data);
        return JSON.parse(jsonStr);
    }
}
export const SpyFakku = new SpyFakkuExtension();
