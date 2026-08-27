import { BasicRateLimiter, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://hiperdex.com";
const MANGA_PATH = "manga";
const SEARCH_LIMIT = 30;
const NUMBER_REGEX = /\d+/;
class HiperdexInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            "user-agent": await Application.getDefaultUserAgent(),
        };
        return request;
    }
    async interceptResponse(_request, _response, data) {
        return data;
    }
}
class HiperdexExtension {
    requestManager = new HiperdexInterceptor("main");
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
        const page = metadata?.page ?? 1;
        const sort = section.id === "popular" ? "popular" : "newest";
        const hits = await this.searchQuery("", page, sort);
        const items = [];
        for (const manga of hits) {
            items.push({
                type: section.id === "popular"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: this.mangaIdFromDto(manga),
                imageUrl: manga.coverUrl ?? "",
                title: manga.title,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: hits.length > 0 ? { page: page + 1 } : undefined,
        };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const hits = await this.searchQuery(query.title.trim(), page);
        const items = [];
        for (const manga of hits) {
            items.push({
                mangaId: this.mangaIdFromDto(manga),
                title: manga.title,
                imageUrl: manga.coverUrl ?? "",
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: hits.length > 0 ? { page: page + 1 } : undefined,
        };
    }
    async getMangaDetails(mangaId) {
        const { slug } = this.parseMangaId(mangaId);
        const input = {
            "0": {
                json: null,
                meta: { values: ["undefined"] },
            },
            "1": {
                json: { slug },
            },
        };
        const element = await this.fetchTrpc("auth.me,series.bySlugWithGenres", input);
        const series = this.dataJson(element);
        if (!series)
            throw new Error("Series not found");
        const genres = (series.genres ?? []).filter(Boolean);
        const authors = (series.authors ?? []).filter(Boolean);
        const artists = (series.artists ?? []).filter(Boolean);
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
                primaryTitle: series.title,
                secondaryTitles: [],
                thumbnailUrl: series.coverUrl ?? "",
                author: authors.length > 0 ? authors.join(", ") : undefined,
                artist: artists.length > 0 ? artists.join(", ") : undefined,
                synopsis: series.synopsis ?? "",
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(series.status),
                tagGroups,
                shareUrl: `${BASE_URL}/${MANGA_PATH}/${slug}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const { slug, id } = this.parseMangaId(sourceManga.mangaId);
        const input = {
            "0": {
                json: { values: ["undefined"] },
            },
            "1": {
                json: {
                    seriesId: id,
                    chapterId: null,
                    sort: "best",
                    page: 1,
                    limit: 20,
                },
                meta: { values: { chapterId: ["undefined"] } },
            },
            "2": {
                json: { seriesId: id },
            },
        };
        const element = await this.fetchTrpc("auth.me,comments.list,series.chapters", input);
        const chaptersDto = this.dataJson(element) ?? [];
        const result = [];
        for (const chap of chaptersDto) {
            result.push({
                chapterId: `${slug}#${chap.number}`,
                sourceManga,
                title: this.buildChapterName(chap),
                volume: 0,
                chapNum: chap.number,
                publishDate: this.parseDate(chap.createdAt),
                langCode: "🇬🇧",
            });
        }
        return result;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const hashIndex = decoded.lastIndexOf("#");
        const slug = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded;
        const numberStr = hashIndex >= 0 ? decoded.slice(hashIndex + 1) : "";
        const chapterNumber = Number(numberStr);
        const input = {
            "0": {
                json: null,
                meta: { values: ["undefined"] },
            },
            "1": {
                json: { slug },
            },
            "2": {
                json: {
                    seriesSlug: slug,
                    chapterNumber: isNaN(chapterNumber) ? 0 : chapterNumber,
                },
            },
        };
        const element = await this.fetchTrpc("auth.me,series.bySlug,reader.chapterPages", input);
        const pageDtos = this.dataJson(element) ?? [];
        const sorted = [...pageDtos].sort((a, b) => a.pageOrder - b.pageOrder);
        const pages = [];
        for (const page of sorted) {
            const url = page.avifUrl ?? page.webpUrl;
            if (url)
                pages.push(url);
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    getMangaShareUrl(mangaId) {
        const { slug } = this.parseMangaId(mangaId);
        return `${BASE_URL}/${MANGA_PATH}/${slug}`;
    }
    // ---- helpers ----
    async searchQuery(query, page, sort) {
        const json = {
            q: query,
        };
        if (sort)
            json.sort = sort;
        json.filters = {
            genres: null,
            type: null,
            status: null,
            contentRating: null,
            author: null,
            artist: null,
            year: null,
        };
        json.limit = SEARCH_LIMIT;
        json.offset = (page - 1) * SEARCH_LIMIT;
        json.maxRating = "pornographic";
        const input = {
            "0": {
                json,
                meta: {
                    values: {
                        "filters.genres": ["undefined"],
                        "filters.type": ["undefined"],
                        "filters.status": ["undefined"],
                        "filters.contentRating": ["undefined"],
                        "filters.author": ["undefined"],
                        "filters.artist": ["undefined"],
                        "filters.year": ["undefined"],
                    },
                },
            },
        };
        const element = await this.fetchTrpc("search.query", input, 0);
        const wrapper = this.dataJson(element);
        return wrapper?.hits ?? [];
    }
    buildChapterName(chap) {
        const numberStr = String(chap.number).replace(/\.0$/, "");
        const labelNumber = `Chapter ${numberStr}`;
        const title = chap.title;
        if (!title)
            return labelNumber;
        return NUMBER_REGEX.test(title) ? title : `${labelNumber} ${title}`;
    }
    mangaIdFromDto(manga) {
        return this.toSafeId(`${manga.slug}#${manga.id}`);
    }
    parseMangaId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const hashIndex = decoded.lastIndexOf("#");
        if (hashIndex < 0)
            return { slug: decoded, id: "" };
        return {
            slug: decoded.slice(0, hashIndex),
            id: decoded.slice(hashIndex + 1),
        };
    }
    parseStatus(status) {
        switch ((status ?? "").toLowerCase()) {
            case "ongoing":
                return "Ongoing";
            case "hiatus":
                return "Hiatus";
            case "cancelled":
                return "Cancelled";
            case "completed":
                return "Completed";
            default:
                return "Unknown";
        }
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        let str = value;
        if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(str))
            str += "Z";
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
    // Navigate result.data.json of a single tRPC batch element.
    dataJson(element) {
        const result = element
            ?.result?.data?.json;
        return (result ?? undefined);
    }
    // Fetch a batched tRPC procedure list. Returns the element at `index`
    // (defaults to the last element, matching upstream `.last()`).
    async fetchTrpc(procedures, input, index) {
        const encoded = encodeURIComponent(JSON.stringify(input));
        const url = `${BASE_URL}/api/trpc/${procedures}?batch=1&input=${encoded}`;
        const arr = await this.fetchJsonWithAuth(url);
        if (!Array.isArray(arr) || arr.length === 0)
            return undefined;
        if (index != null)
            return arr[index];
        return arr[arr.length - 1];
    }
    async fetchJsonWithAuth(url) {
        let [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        // The API returns 401 until a session cookie is populated by loading
        // the homepage; fetch it once then retry.
        if (response.status === 401) {
            await Application.scheduleRequest({
                url: BASE_URL,
                method: "GET",
                headers: {
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            });
            [response, data] = await Application.scheduleRequest({
                url,
                method: "GET",
            });
        }
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
}
export const Hiperdex = new HiperdexExtension();
