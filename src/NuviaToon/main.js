import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://nuviatoon.com";
const API_URL = `${BASE_URL}/nuvia-api`;
const PER_PAGE = 18;
class NuviaToonInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
            accept: "application/json",
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
class NuviaToonExtension {
    requestManager = new NuviaToonInterceptor("main");
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
    async getDiscoverSections() {
        return [
            {
                id: "views",
                title: "Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "created_at",
                title: "Latest Updates",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        const url = `${API_URL}/series?per_page=${PER_PAGE}&page=${page}&sort=${section.id}&dir=desc`;
        const response = await this.fetchJson(url);
        const list = response.data ?? [];
        const items = [];
        for (const series of list) {
            const parsed = this.itemFromDto(series);
            if (!parsed)
                continue;
            items.push({
                type: section.id === "views"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: this.hasNextPage(response.meta)
                ? { page: page + 1 }
                : undefined,
        };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        let url = `${API_URL}/series?per_page=${PER_PAGE}&page=${page}`;
        if (titleQuery)
            url += `&q=${encodeURIComponent(titleQuery)}`;
        url += `&sort=views&dir=desc`;
        const response = await this.fetchJson(url);
        const list = response.data ?? [];
        const items = [];
        for (const series of list) {
            const parsed = this.itemFromDto(series);
            if (!parsed)
                continue;
            items.push({
                mangaId: parsed.mangaId,
                title: parsed.title,
                imageUrl: parsed.imageUrl,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: this.hasNextPage(response.meta)
                ? { page: page + 1 }
                : undefined,
        };
    }
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const series = await this.fetchJson(`${API_URL}/series/${slug}`);
        const genres = (series.genres ?? []).filter((g) => g.length > 0);
        const tagGroups = genres.length > 0
            ? [
                {
                    id: "genres",
                    title: "Genres",
                    tags: genres.map((g) => ({
                        id: g.toLowerCase().replace(/\s+/g, "-"),
                        title: g,
                    })),
                },
            ]
            : [];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: series.title ?? slug,
                secondaryTitles: [],
                thumbnailUrl: series.cover_url ?? "",
                author: series.author ?? undefined,
                artist: series.artist ?? undefined,
                synopsis: series.description ?? "",
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(series.status),
                tagGroups,
                shareUrl: `${BASE_URL}/series/${slug}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const chapters = await this.fetchJson(`${API_URL}/series/${slug}/chapters`);
        const result = [];
        for (const chap of chapters) {
            if (!chap.id)
                continue;
            const numberString = chap.number != null ? String(chap.number).replace(/\.0$/, "") : "";
            const name = chap.title || `Chapter ${numberString}`.trim();
            result.push({
                chapterId: `${slug}/chapter/${numberString}?id=${chap.id}`,
                sourceManga,
                title: name,
                volume: 0,
                chapNum: chap.number ?? -1,
                publishDate: this.parseDate(chap.created_at),
                langCode: "🇬🇧",
            });
        }
        // Upstream reverses the API order (API returns newest-first data set).
        return result.reverse();
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const id = decoded.split("id=")[1] ?? "";
        const pageDtos = await this.fetchJson(`${API_URL}/chapters/${id}/pages`);
        const pages = [];
        for (const dto of pageDtos) {
            if (dto.image_url)
                pages.push(dto.image_url);
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
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
    // ---- helpers ----
    itemFromDto(series) {
        if (!series.slug)
            return undefined;
        return {
            mangaId: this.toSafeId(series.slug),
            imageUrl: series.cover_url ?? "",
            title: series.title ?? series.slug,
        };
    }
    hasNextPage(meta) {
        if (!meta)
            return false;
        const current = meta.current_page ?? 1;
        const last = meta.last_page ?? current;
        return current < last;
    }
    parseStatus(status) {
        const s = (status ?? "").toLowerCase();
        if (s === "ongoing")
            return "Ongoing";
        if (s === "completed")
            return "Completed";
        if (s === "hiatus")
            return "Hiatus";
        if (s === "dropped")
            return "Cancelled";
        return "Unknown";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const str = value.split(".")[0] + "Z";
        const date = new Date(str);
        return isNaN(date.getTime()) ? new Date(0) : date;
    }
    toSafeId(slug) {
        return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
            const enc = encodeURIComponent(c);
            return enc !== c
                ? enc
                : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
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
    async fetchJson(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
}
export const NuviaToon = new NuviaToonExtension();
