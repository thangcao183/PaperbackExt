import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import { ScansGGSearchForm, TAG_OPTIONS } from "./forms";
const BASE_URL = "https://scans.gg";
const API_URL = "https://api.scans.gg";
const CDN_URL = "https://cdn.scans.gg/uploads";
const POPULAR_LIMIT = 21;
const LATEST_LIMIT = 14;
const CHAPTER_LIMIT = 100;
const TAG_MAP = (() => {
    const map = {};
    for (const t of TAG_OPTIONS)
        map[parseInt(t.id, 10)] = t.title;
    return map;
})();
class ScansGGInterceptor extends PaperbackInterceptor {
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
class ScansGGExtension {
    requestManager = new ScansGGInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
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
    async getDiscoverSections() {
        return [
            { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
            { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        if (section.id === "latest") {
            const data = await this.fetchJson({
                url: `${API_URL}/chapters?page=${page}&limit=${LATEST_LIMIT}` +
                    `&chapters=true&series_details=true&group_details=true&sort=date`,
                method: "GET",
            });
            const items = (data.data ?? []).map((s) => ({
                type: "simpleCarouselItem",
                mangaId: this.toSafeId(String(s.id)),
                imageUrl: this.coverUrl(s.cover),
                title: s.title,
                metadata: undefined,
            }));
            return { items, metadata: data.meta?.has_more ? { page: page + 1 } : undefined };
        }
        const data = await this.fetchJson({
            url: `${API_URL}/series?limit=${POPULAR_LIMIT}&offset=${(page - 1) * POPULAR_LIMIT}`,
            method: "GET",
        });
        const list = data.data ?? [];
        const items = list.map((s) => ({
            type: "featuredCarouselItem",
            mangaId: this.toSafeId(String(s.id)),
            imageUrl: this.coverUrl(s.cover),
            title: s.title,
            metadata: undefined,
        }));
        return { items, metadata: list.length === POPULAR_LIMIT ? { page: page + 1 } : undefined };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = query.title.trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        const params = [
            `limit=${POPULAR_LIMIT}`,
            `offset=${(page - 1) * POPULAR_LIMIT}`,
        ];
        if (titleQuery.length > 0)
            params.push(`q=${encodeURIComponent(titleQuery)}`);
        params.push(`q_type=${encodeURIComponent(`[${(searchMeta?.types ?? []).join(",")}]`)}`);
        params.push(`q_status=${encodeURIComponent(`[${(searchMeta?.statuses ?? []).join(",")}]`)}`);
        params.push(`q_tags=${encodeURIComponent(`[${(searchMeta?.tags ?? []).join(",")}]`)}`);
        const data = await this.fetchJson({
            url: `${API_URL}/series?${params.join("&")}`,
            method: "GET",
        });
        const list = data.data ?? [];
        const items = list.map((s) => ({
            mangaId: this.toSafeId(String(s.id)),
            imageUrl: this.coverUrl(s.cover),
            title: s.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: list.length === POPULAR_LIMIT ? { page: page + 1 } : undefined };
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new ScansGGSearchForm(meta);
    }
    async getMangaDetails(mangaId) {
        const seriesId = this.safeDecode(mangaId);
        const data = await this.fetchJson({
            url: `${API_URL}/series?id=${encodeURIComponent(seriesId)}&trackers=true&sources=true`,
            method: "GET",
        });
        const s = data.data;
        const genreNames = (s.tags ?? [])
            .map((t) => TAG_MAP[t])
            .filter((t) => Boolean(t));
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
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: s.title,
                secondaryTitles: [],
                thumbnailUrl: this.coverUrl(s.cover),
                author: s.author && s.author.length > 0 ? s.author.join(", ") : undefined,
                artist: s.artist && s.artist.length > 0 ? s.artist.join(", ") : undefined,
                synopsis: (s.summary ?? "").trim(),
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(s.status),
                tagGroups,
                shareUrl: `${BASE_URL}/series/${seriesId}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const seriesId = this.safeDecode(sourceManga.mangaId);
        const chapters = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const data = await this.fetchJson({
                url: `${API_URL}/chapters?series_id=${encodeURIComponent(seriesId)}` +
                    `&limit=${CHAPTER_LIMIT}&page=${page}&group_details=true`,
                method: "GET",
            });
            for (const ch of data.data ?? []) {
                const numStr = String(ch.number).replace(/\.0$/, "");
                let name = `Chapter ${numStr}`;
                if (ch.title && ch.title.length > 0)
                    name += ` - ${ch.title}`;
                const path = `/chapter-navigation?series_id=${seriesId}&chapter_id=${ch.id}&group_id=${ch.group_id ?? 0}`;
                chapters.push({
                    chapterId: this.toSafeId(path),
                    sourceManga,
                    title: name,
                    volume: 0,
                    chapNum: ch.number,
                    publishDate: this.parseDate(ch.created_at),
                    langCode: "\ud83c\uddec\ud83c\udde7",
                });
            }
            hasMore = data.meta?.has_more === true;
            page++;
            if (page > 100)
                break;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const path = this.safeDecode(chapter.chapterId);
        const data = await this.fetchJson({
            url: `${API_URL}${path}`,
            method: "GET",
        });
        const ch = data.data.chapter;
        const chapterId = ch?.id;
        const pages = chapterId != null && ch?.pages
            ? ch.pages.map((p) => `${CDN_URL}/pages/${chapterId}/${p.path}`)
            : [];
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    async getMangaShareUrl(mangaId) {
        return `${BASE_URL}/series/${this.safeDecode(mangaId)}`;
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
    coverUrl(cover) {
        if (!cover)
            return "";
        return `${CDN_URL}/covers/${cover}`;
    }
    parseStatus(status) {
        switch (status) {
            case 1:
                return "Ongoing";
            case 2:
                return "Completed";
            case 3:
            case 4:
            case 5:
                return "Cancelled";
            default:
                return "Unknown";
        }
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
        const d = new Date(iso);
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
export const ScansGG = new ScansGGExtension();
