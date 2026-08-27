import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://hentara.com";
const API_BASE = "https://hentara.com/r2-data";
const GENRES = [
    "Any",
    "Action",
    "BL",
    "Cheating",
    "Detective",
    "Drama",
    "Harem",
    "In-Law",
    "MILF",
    "Married",
    "Office",
    "Romance",
    "Spin-Off",
    "Thriller",
    "University",
    "College",
    "Nerd",
];
// 0 = Latest, 1 = Popular, 2 = Alphabetical
const SORT_LATEST = 0;
const SORT_POPULAR = 1;
const SORT_ALPHABETICAL = 2;
class HentaraInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json,text/plain,*/*",
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
export class HentaraExtension {
    requestManager = new HentaraInterceptor("main");
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
    async getDiscoverSectionItems(section, _metadata) {
        if (section.id === "genres") {
            const items = GENRES.filter((g) => g !== "Any").map((genre) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { genre },
                },
                name: genre,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const sort = section.id === "popular" ? SORT_POPULAR : SORT_LATEST;
        const comics = await this.fetchSortedComics("", "Any", sort);
        const items = comics.map((comic) => {
            const parsed = this.comicToItem(comic);
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
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const meta = query.metadata;
        const titleQuery = (query.title || "").trim();
        const genre = meta?.genre ?? "Any";
        const sort = meta?.sort ?? SORT_LATEST;
        const comics = await this.fetchSortedComics(titleQuery, genre, sort);
        const items = comics.map((comic) => {
            const parsed = this.comicToItem(comic);
            return {
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            };
        });
        return { items, metadata: undefined };
    }
    async fetchSortedComics(query, genre, sort) {
        const data = await this.fetchJson({
            url: `${API_BASE}/index.json`,
            method: "GET",
        });
        const q = query.toLowerCase();
        const wantGenre = genre.toLowerCase();
        const filtered = (data.comics ?? []).filter((comic) => {
            const title = (comic.title ?? "").toLowerCase();
            const matchesQuery = q === "" || title.includes(q);
            const matchesGenre = wantGenre === "any" ||
                wantGenre === "" ||
                (comic.genres ?? []).some((g) => (g.name ?? "").toLowerCase() === wantGenre);
            return matchesQuery && matchesGenre;
        });
        const sorted = [...filtered];
        if (sort === SORT_POPULAR) {
            sorted.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
        }
        else if (sort === SORT_ALPHABETICAL) {
            sorted.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
        }
        else {
            // Latest: by latest_episode_date descending
            sorted.sort((a, b) => this.parseDate(b.latest_episode_date).getTime() -
                this.parseDate(a.latest_episode_date).getTime());
        }
        return sorted;
    }
    comicToItem(comic) {
        return {
            mangaId: this.toSafeId(comic.slug ?? ""),
            imageUrl: comic.thumbnail_url ?? "",
            title: comic.title ?? this.safeDecode(comic.slug ?? ""),
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.slugFromId(mangaId);
        const data = await this.fetchJson({
            url: `${API_BASE}/comics/${slug}.json`,
            method: "GET",
        });
        const comic = data.comic ?? {};
        const genres = (comic.genres ?? [])
            .map((g) => (g.name ?? "").trim())
            .filter((g) => g.length > 0);
        const tagGroups = [];
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
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: comic.title ?? this.safeDecode(slug),
                secondaryTitles: [],
                thumbnailUrl: comic.thumbnail_url ?? "",
                synopsis: comic.description ?? "",
                contentRating: ContentRating.MATURE,
                status: "Unknown",
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.slugFromId(sourceManga.mangaId);
        const data = await this.fetchJson({
            url: `${API_BASE}/comics/${slug}.json`,
            method: "GET",
        });
        const chapters = (data.episodes ?? []).map((ep) => {
            const epNum = ep.episode_number ?? 0;
            let title = `Chapter ${epNum}`;
            if (ep.title && ep.title.trim().length > 0) {
                title += ` - ${ep.title.trim()}`;
            }
            return {
                chapterId: this.toSafeId(`${slug}/chapter-${epNum}`),
                sourceManga,
                title,
                volume: 0,
                chapNum: epNum,
                publishDate: this.parseDate(ep.created_at),
                langCode: "🇬🇧",
            };
        });
        chapters.sort((a, b) => b.chapNum - a.chapNum);
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const segments = decoded.replace(/^\/+|\/+$/g, "").split("/");
        if (segments.length < 2) {
            throw new Error(`Malformed chapter id: ${chapter.chapterId}`);
        }
        const slug = segments[0];
        const ep = parseInt(segments[1].replace("chapter-", ""), 10);
        if (Number.isNaN(ep)) {
            throw new Error(`Malformed chapter id: ${chapter.chapterId}`);
        }
        const data = await this.fetchJson({
            url: `${API_BASE}/episodes/${slug}/${ep}.json`,
            method: "GET",
        });
        const pages = [...(data.pages ?? [])]
            .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))
            .map((p) => this.absoluteUrl(p.image_url ?? ""))
            .filter((u) => u.length > 0);
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
    slugFromId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
        return cleaned.includes("/") ? cleaned.split("/").pop() ?? "" : cleaned;
    }
    mangaUrl(mangaId) {
        const slug = this.slugFromId(mangaId);
        return `${BASE_URL}/manhwa/${slug}`;
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
    parseDate(value) {
        if (!value)
            return new Date(0);
        const t = Date.parse(value);
        return Number.isNaN(t) ? new Date(0) : new Date(t);
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
}
export const Hentara = new HentaraExtension();
