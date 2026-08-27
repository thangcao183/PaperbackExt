import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { AlandalSearchForm } from "./forms";
const BASE_URL = "https://alandal.com";
const API_URL = "https://qq.alandal.com/api";
class AlandalInterceptor extends PaperbackInterceptor {
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
                headers: { "user-agent": await Application.getDefaultUserAgent() },
            });
        }
        return data;
    }
}
class AlandalExtension {
    requestManager = new AlandalInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 1,
        bufferInterval: 1,
        ignoreImages: true,
    });
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    async getDiscoverSections() {
        return [
            { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
            { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        const sort = section.id === "popular" ? "popular" : "new";
        const url = `${API_URL}/series?type=comic&sort=${sort}&page=${page}`;
        const result = await this.fetchJson({ url, method: "GET" });
        const series = result.data.series;
        const itemType = section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
        const items = (series.data ?? []).map((s) => ({
            type: itemType,
            mangaId: this.toSafeId(s.slug),
            imageUrl: s.cover,
            title: s.name,
            metadata: undefined,
        }));
        const hasNextPage = series.current_page < series.last_page;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = query.title.trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        let url = `${API_URL}/series?type=comic`;
        if (titleQuery.length > 0)
            url += `&name=${encodeURIComponent(titleQuery)}`;
        const genres = searchMeta?.genres ?? [];
        if (genres.length > 0) {
            for (const g of genres)
                url += `&genres=${encodeURIComponent(g)}`;
        }
        else {
            url += `&genres=-1`;
        }
        const sort = searchMeta?.sort?.[0];
        if (sort && sort.length > 0)
            url += `&sort=${encodeURIComponent(sort)}`;
        const status = searchMeta?.status?.[0];
        if (status && status.length > 0)
            url += `&status=${encodeURIComponent(status)}`;
        url += `&page=${page}`;
        const result = await this.fetchJson({ url, method: "GET" });
        const series = result.data.series;
        const items = (series.data ?? []).map((s) => ({
            mangaId: this.toSafeId(s.slug),
            imageUrl: s.cover,
            title: s.name,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNextPage = series.current_page < series.last_page;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new AlandalSearchForm(meta);
    }
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const result = await this.fetchJson({
            url: `${API_URL}/series/${slug}?type=comic`,
            method: "GET",
        });
        const series = result.data.series;
        const genreNames = (series.genres ?? []).map((g) => g.name);
        const tagGroups = genreNames.length > 0
            ? [
                {
                    id: "genres",
                    title: "Genres",
                    tags: genreNames.map((g) => ({
                        id: g.toLowerCase().replace(/\s+/g, "-"),
                        title: g,
                    })),
                },
            ]
            : [];
        const author = (series.creators ?? [])
            .filter((c) => c.type === "author")
            .map((c) => c.name)
            .join(", ");
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.name,
                secondaryTitles: [],
                thumbnailUrl: series.cover,
                author: author.length > 0 ? author : undefined,
                synopsis: this.stripHtml(series.summary ?? ""),
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(series.status?.name),
                tagGroups,
                shareUrl: `${BASE_URL}/series/comic-${slug}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const result = await this.fetchJson({
            url: `${API_URL}/series/${slug}/chapters?type=comic&from=0&to=999`,
            method: "GET",
        });
        const chapters = (result.data ?? []).map((ch) => {
            const prefix = ch.access ? "" : "[LOCKED] ";
            const num = this.parseChapterNumber(ch.name);
            return {
                chapterId: this.toSafeId(`${slug}#${ch.name}`),
                sourceManga,
                title: `${prefix}Chapter ${ch.name}`,
                volume: 0,
                chapNum: num,
                publishDate: this.parseDate(ch.published_at),
                langCode: "\ud83c\uddec\ud83c\udde7",
            };
        });
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        if ((chapter.title ?? "").startsWith("[LOCKED]")) {
            throw new Error("Log in and unlock chapter in webview, then refresh chapter list");
        }
        const decoded = this.safeDecode(chapter.chapterId);
        const [slug, chapterName] = decoded.split("#");
        const result = await this.fetchJson({
            url: `${API_URL}/series/${slug}/chapters/${chapterName}?type=comic&traveler=0`,
            method: "GET",
        });
        const pages = result.data.chapter.chapter.pages ?? [];
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    async getMangaShareUrl(mangaId) {
        return `${BASE_URL}/series/comic-${this.safeDecode(mangaId)}`;
    }
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
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
    stripHtml(html) {
        return html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .trim();
    }
    parseStatus(status) {
        const s = (status ?? "").toLowerCase();
        if (s === "ongoing")
            return "Ongoing";
        if (s === "completed")
            return "Completed";
        return "Unknown";
    }
    parseChapterNumber(name) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : -1;
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const d = new Date(value);
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
}
export const Alandal = new AlandalExtension();
