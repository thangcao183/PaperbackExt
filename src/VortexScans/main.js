import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://vortexscans.org";
const API_URL = "https://api.vortexscans.org";
const SERIES_PATH_SEGMENT = "series";
const PER_PAGE = 18;
const POPULAR_ORDER_BY = "totalViews";
const LATEST_ORDER_BY = "lastChapterAddedAt";
const ORDER_DESC = "desc";
// Genre options ported from upstream Constants.kt (name -> id).
const GENRE_OPTIONS = [
    { title: "Action", id: "1" },
    { title: "Drama", id: "2" },
    { title: "Shounen", id: "3" },
    { title: "Sports", id: "4" },
    { title: "Manhwa", id: "5" },
    { title: "Martial Arts", id: "6" },
    { title: "Comedy", id: "7" },
    { title: "Fantasy", id: "8" },
    { title: "Horror", id: "9" },
    { title: "Seinen", id: "10" },
    { title: "Supernatural", id: "11" },
    { title: "Mature", id: "12" },
    { title: "Adventure", id: "13" },
    { title: "Monsters", id: "14" },
    { title: "System", id: "15" },
    { title: "Reincarnation", id: "16" },
    { title: "Revenge", id: "17" },
    { title: "Slice Of Life", id: "18" },
    { title: "Historical", id: "19" },
    { title: "Romance", id: "20" },
    { title: "Josei", id: "21" },
    { title: "Shoujo", id: "22" },
    { title: "School Life", id: "23" },
    { title: "terror", id: "24" },
    { title: "elf", id: "25" },
    { title: "shojo", id: "26" },
    { title: "Video Games", id: "27" },
    { title: "Fantas", id: "28" },
    { title: "WEB COMIC", id: "29" },
    { title: "Webtoons", id: "30" },
    { title: "Murim", id: "31" },
    { title: "Restaurant", id: "32" },
    { title: "Webtoon", id: "33" },
    { title: "+100 Chapter", id: "34" },
    { title: "Tower", id: "35" },
    { title: "Legendary", id: "36" },
    { title: "Dungeons", id: "37" },
    { title: "bully", id: "38" },
    { title: "orphan", id: "39" },
    { title: "Sci-Fi", id: "40" },
    { title: "Gore", id: "41" },
    { title: "Isekai", id: "42" },
    { title: "magic", id: "43" },
    { title: "blood", id: "44" },
    { title: "war", id: "45" },
    { title: "magic and sword", id: "46" },
    { title: "academy", id: "47" },
    { title: "violence", id: "48" },
    { title: "Harem", id: "49" },
    { title: "Myth", id: "50" },
    { title: "OverpoweredMC", id: "51" },
    { title: "TerritoryManagement", id: "52" },
    { title: "Swordsman", id: "53" },
    { title: "Necromancer", id: "54" },
    { title: "Mage", id: "55" },
    { title: "JackOfAllTrades", id: "56" },
    { title: "Artifacts", id: "57" },
    { title: "CharacterGrowth", id: "58" },
    { title: "Mercenary", id: "59" },
    { title: "Elementals", id: "60" },
    { title: "Genius", id: "61" },
    { title: "Psychological", id: "62" },
    { title: "Tragedy", id: "63" },
    { title: "Gender Bender", id: "64" },
];
class VortexScansInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
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
export class VortexScansExtension {
    requestManager = new VortexScansInterceptor("main");
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
            const items = GENRE_OPTIONS.map((g) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { searchMeta: { genre: g.id } },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const orderBy = section.id === "popular" ? POPULAR_ORDER_BY : LATEST_ORDER_BY;
        const url = this.queryUrl({
            page,
            query: "",
            orderBy,
            orderDirection: ORDER_DESC,
        });
        const payload = await this.fetchJson(url);
        const posts = payload.posts ?? [];
        const items = [];
        const seen = new Set();
        for (const post of posts) {
            const parsed = this.summaryToItem(post);
            if (!parsed || seen.has(parsed.mangaId))
                continue;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        }
        const hasNext = (payload.totalCount ?? 0) > page * PER_PAGE;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const url = this.queryUrl({
            page,
            query: titleQuery,
            genreInclude: searchMeta?.genre,
        });
        const payload = await this.fetchJson(url);
        const posts = payload.posts ?? [];
        const results = [];
        for (const post of posts) {
            const parsed = this.summaryToItem(post);
            if (!parsed)
                continue;
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        const hasNext = (payload.totalCount ?? 0) > page * PER_PAGE;
        return {
            items: results,
            metadata: hasNext ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const postId = await this.resolvePostId(mangaId);
        const url = this.postUrl(postId);
        const payload = await this.fetchJson(url);
        const post = payload.post;
        const title = post.postTitle.trim() || this.slugFromId(mangaId);
        const genreTitles = (post.genres ?? [])
            .map((g) => (g.name || "").trim())
            .filter((g) => g.length > 0);
        const seriesTypeTag = this.seriesTypeLabel(post.seriesType);
        if (seriesTypeTag && !genreTitles.includes(seriesTypeTag)) {
            genreTitles.unshift(seriesTypeTag);
        }
        const tagGroups = [];
        if (genreTitles.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genreTitles.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: this.parseAlternativeTitles(post.alternativeTitles),
                thumbnailUrl: this.absoluteUrl(post.featuredImage || ""),
                author: (post.author || "").trim() || undefined,
                artist: (post.artist || "").trim() || undefined,
                synopsis: this.buildSynopsis(post.postContent),
                contentRating: ContentRating.EVERYONE,
                status: this.mapStatus(post.seriesStatus),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const postId = await this.resolvePostId(sourceManga.mangaId);
        const url = this.postUrl(postId);
        const payload = await this.fetchJson(url);
        const post = payload.post;
        const mangaSlug = post.slug;
        const chapters = [];
        for (const ch of post.chapters ?? []) {
            const accessible = ch.isAccessible !== false && ch.isLocked !== true;
            if (!accessible)
                continue;
            const rawNumber = this.chapterNumberText(ch);
            const chapNum = parseFloat(rawNumber);
            const titleParts = [];
            titleParts.push(rawNumber ? `Chapter ${rawNumber}` : "Chapter");
            const chapterTitle = (ch.title || "").trim();
            if (chapterTitle)
                titleParts.push(chapterTitle);
            const chapterId = this.toSafeId(`${mangaSlug}/${ch.slug}#${ch.id}`);
            chapters.push({
                chapterId,
                sourceManga,
                title: titleParts.join(" - "),
                volume: 0,
                chapNum: isNaN(chapNum) ? 0 : chapNum,
                publishDate: this.parseDate(ch.createdAt),
                langCode: "🇬🇧",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const chapterId = await this.resolveChapterId(chapter.chapterId);
        const url = this.chapterUrl(chapterId);
        const payload = await this.fetchJson(url);
        const ch = payload.chapter;
        if (ch.isAccessible === false || ch.isLocked === true) {
            throw new Error("Unlock chapter in WebView");
        }
        const images = [...(ch.images ?? [])].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) -
            (b.order ?? Number.MAX_SAFE_INTEGER));
        const pages = [];
        for (const img of images) {
            const u = this.absoluteUrl(img.url);
            if (u)
                pages.push(u);
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
    // URL builders (API)
    // ----------------------------------------------------------------
    queryUrl(opts) {
        const params = [];
        params.push(`page=${opts.page}`);
        params.push(`perPage=${PER_PAGE}`);
        params.push(`searchTerm=${encodeURIComponent(opts.query)}`);
        if (opts.genreInclude) {
            params.push(`genreIds=${encodeURIComponent(opts.genreInclude)}`);
        }
        if (opts.orderBy) {
            params.push(`orderBy=${encodeURIComponent(opts.orderBy)}`);
        }
        if (opts.orderDirection) {
            params.push(`orderDirection=${encodeURIComponent(opts.orderDirection)}`);
        }
        return `${API_URL}/api/query?${params.join("&")}`;
    }
    postUrl(postId) {
        return `${API_URL}/api/post?postId=${postId}`;
    }
    chapterUrl(chapterId) {
        return `${API_URL}/api/chapter?chapterId=${chapterId}`;
    }
    // ----------------------------------------------------------------
    // Id resolution
    // ----------------------------------------------------------------
    // mangaId encodes "slug#id". Returns the embedded post id, or resolves by slug.
    async resolvePostId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const embedded = decoded.split("#")[1];
        const parsed = embedded ? parseInt(embedded, 10) : NaN;
        if (!isNaN(parsed))
            return parsed;
        const slug = this.slugFromId(mangaId);
        const summary = await this.findPostBySlug(slug);
        if (!summary)
            throw new Error("Unable to resolve series id");
        return summary.id;
    }
    // chapterId encodes "mangaSlug/chapterSlug#id".
    async resolveChapterId(chapterId) {
        const decoded = this.safeDecode(chapterId);
        const beforeHash = decoded.split("#")[0];
        const embedded = decoded.split("#")[1];
        const parsed = embedded ? parseInt(embedded, 10) : NaN;
        if (!isNaN(parsed))
            return parsed;
        const segments = beforeHash.split("/").filter((s) => s.length > 0);
        if (segments.length < 2)
            throw new Error("Unable to resolve chapter id");
        const mangaSlug = segments[segments.length - 2];
        const chapterSlug = segments[segments.length - 1];
        const summary = await this.findPostBySlug(mangaSlug);
        if (!summary)
            throw new Error("Unable to resolve series id");
        const payload = await this.fetchJson(this.postUrl(summary.id));
        const chapterDto = (payload.post.chapters ?? []).find((c) => c.slug === chapterSlug);
        if (!chapterDto)
            throw new Error("Unable to resolve chapter id");
        return chapterDto.id;
    }
    async findPostBySlug(slug) {
        const normalizedSlug = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
        const terms = this.buildSlugSearchTerms(normalizedSlug);
        for (const term of terms) {
            try {
                const payload = await this.fetchJson(this.queryUrl({ page: 1, query: term }));
                const post = (payload.posts ?? []).find((p) => p.slug.toLowerCase() === normalizedSlug);
                if (post)
                    return post;
            }
            catch {
                // try next term
            }
        }
        return undefined;
    }
    buildSlugSearchTerms(slug) {
        const withSpaces = slug.replace(/-/g, " ");
        const withoutApostrophe = withSpaces.replace(/'/g, " ");
        const collapsed = withoutApostrophe.replace(/\s+/g, " ");
        const candidates = [withSpaces, withoutApostrophe, collapsed, slug]
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        return [...new Set(candidates)];
    }
    // ----------------------------------------------------------------
    // Mapping helpers
    // ----------------------------------------------------------------
    summaryToItem(post) {
        const title = (post.postTitle || "").trim();
        if (!title)
            return undefined;
        const mangaId = this.toSafeId(`${post.slug}#${post.id}`);
        return {
            mangaId,
            imageUrl: this.absoluteUrl(post.featuredImage || ""),
            title,
        };
    }
    chapterNumberText(ch) {
        const raw = this.numberToString(ch.number);
        if (raw)
            return raw;
        const fromSlug = ch.slug.split("chapter-")[1] || "";
        return fromSlug.trim();
    }
    numberToString(value) {
        if (typeof value === "number")
            return value.toString();
        if (typeof value === "string")
            return value.trim();
        return "";
    }
    parseAlternativeTitles(alt) {
        if (!alt)
            return [];
        return alt
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    buildSynopsis(content) {
        if (!content)
            return "";
        const withBreaks = content
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "");
        return this.decodeHtmlEntities(withBreaks).trim();
    }
    decodeHtmlEntities(text) {
        return text
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, " ");
    }
    seriesTypeLabel(seriesType) {
        switch ((seriesType || "").toUpperCase()) {
            case "MANGA":
                return "Manga";
            case "MANHUA":
                return "Manhua";
            case "MANHWA":
                return "Manhwa";
            default:
                return "";
        }
    }
    mapStatus(status) {
        switch ((status || "").toUpperCase()) {
            case "ONGOING":
            case "COMING_SOON":
            case "MASS_RELEASED":
                return "Ongoing";
            case "COMPLETED":
                return "Completed";
            case "CANCELLED":
            case "DROPPED":
                return "Cancelled";
            default:
                return "Unknown";
        }
    }
    parseDate(raw) {
        if (!raw)
            return new Date(0);
        const t = Date.parse(raw);
        return isNaN(t) ? new Date(0) : new Date(t);
    }
    // ----------------------------------------------------------------
    // Public URL helpers (for sharing)
    // ----------------------------------------------------------------
    mangaUrl(mangaId) {
        const slug = this.slugFromId(mangaId);
        return `${BASE_URL}/${SERIES_PATH_SEGMENT}/${slug}`;
    }
    slugFromId(id) {
        const decoded = this.safeDecode(id);
        const beforeHash = decoded.split("#")[0];
        const segments = beforeHash.split("/").filter((s) => s.length > 0);
        if (segments.length === 0)
            return beforeHash;
        if (segments.length >= 2 && segments[0] === SERIES_PATH_SEGMENT) {
            return segments[1];
        }
        return segments[0];
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
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
}
export const VortexScans = new VortexScansExtension();
