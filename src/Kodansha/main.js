import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const DOMAIN = "kodansha.us";
const BASE_URL = `https://${DOMAIN}`;
const API_URL = `https://api.${DOMAIN}`;
const PAGE_LIMIT = 24;
// Genres exposed for discover-based browsing (ported from upstream Filters.kt).
const GENRES = [
    { id: "12", title: "Action & Adventure" },
    { id: "17", title: "Arts & Entertainment" },
    { id: "21", title: "Biography" },
    { id: "9", title: "Comedy" },
    { id: "28", title: "Crafts" },
    { id: "1", title: "Drama" },
    { id: "4", title: "Fantasy" },
    { id: "18", title: "Fiction & Literature" },
    { id: "14", title: "Food" },
    { id: "33", title: "Games" },
    { id: "25", title: "General Nonfiction" },
    { id: "15", title: "Historical" },
    { id: "34", title: "History & Politics" },
    { id: "6", title: "Horror" },
    { id: "16", title: "Isekai" },
    { id: "32", title: "Language" },
    { id: "20", title: "LGBTQ" },
    { id: "5", title: "Made into Anime" },
    { id: "30", title: "Martial Arts" },
    { id: "19", title: "Movie/TV Tie-in" },
    { id: "31", title: "Philosophy" },
    { id: "29", title: "Reference" },
    { id: "22", title: "Religion & Spirituality" },
    { id: "2", title: "Romance" },
    { id: "8", title: "School Life" },
    { id: "7", title: "Science-Fiction" },
    { id: "10", title: "Slice of Life" },
    { id: "11", title: "Sports" },
    { id: "35", title: "Supernatural" },
    { id: "13", title: "Thriller" },
    { id: "24", title: "Videogame Tie-in" },
    { id: "3", title: "Yaoi/BL" },
    { id: "23", title: "Yuri" },
];
class KodanshaInterceptor extends PaperbackInterceptor {
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
export class KodanshaExtension {
    requestManager = new KodanshaInterceptor("main");
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
                title: "New and Popular",
                type: DiscoverSectionType.featured,
            },
            {
                id: "latest",
                title: "Newest",
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
                searchQuery: {
                    title: "",
                    metadata: { genreId: g.id },
                },
                name: g.title,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const fromIndex = meta?.fromIndex ?? 0;
        const sort = section.id === "popular" ? "0" : "5";
        const url = this.discoverUrl(sort, fromIndex);
        const result = await this.fetchJson(url);
        const { items: parsed, hasNextPage } = this.parseEntries(result, fromIndex);
        const items = parsed.map((p) => ({
            type: section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem",
            mangaId: p.mangaId,
            imageUrl: p.imageUrl,
            title: p.title,
            metadata: undefined,
        }));
        return {
            items,
            metadata: hasNextPage ? { fromIndex: fromIndex + PAGE_LIMIT } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const titleQuery = (query.title || "").trim();
        const meta = metadata;
        // Text search uses the dedicated search endpoint (single, non-paged result set).
        if (titleQuery !== "") {
            const url = `${API_URL}/search/V3?query=${encodeURIComponent(titleQuery)}&platform=web&showSpotLightInfo=true`;
            const result = await this.fetchJson(url);
            const { items } = this.parseEntries(result, 0);
            return {
                items: items.map((p) => ({
                    mangaId: p.mangaId,
                    imageUrl: p.imageUrl,
                    title: p.title,
                    subtitle: undefined,
                    metadata: undefined,
                })),
                metadata: undefined,
            };
        }
        // Empty query -> browse via discover endpoint, optionally filtered by genre.
        const genreId = meta?.genreId ??
            query.metadata?.genreId;
        const fromIndex = meta?.fromIndex ?? 0;
        let url = this.discoverUrl("0", fromIndex);
        if (genreId) {
            url += `&genreIds=${encodeURIComponent(genreId)}`;
        }
        const result = await this.fetchJson(url);
        const { items, hasNextPage } = this.parseEntries(result, fromIndex);
        return {
            items: items.map((p) => ({
                mangaId: p.mangaId,
                imageUrl: p.imageUrl,
                title: p.title,
                subtitle: undefined,
                metadata: undefined,
            })),
            metadata: hasNextPage
                ? { fromIndex: fromIndex + PAGE_LIMIT, genreId }
                : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const id = this.seriesId(mangaId);
        const url = `${API_URL}/series/V2/${id}`;
        const result = await this.fetchJson(url);
        const d = result.response ?? {};
        const author = (d.creators ?? [])
            .map((c) => `${c.title ?? ""}: ${c.name ?? ""}`.trim())
            .filter((s) => s !== ":" && s !== "")
            .join(", ");
        const descriptionParts = [];
        if (d.description) {
            descriptionParts.push(this.stripHtml(d.description));
        }
        if (d.publisher && d.publisher.trim()) {
            descriptionParts.push(`Publisher: ${d.publisher}`);
        }
        if (d.ageRating && d.ageRating.trim()) {
            descriptionParts.push(d.ageRating);
        }
        const genres = (d.genres ?? [])
            .map((g) => g.name ?? "")
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
                primaryTitle: d.title ?? this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl: d.thumbnails?.[0]?.url ?? "",
                author: author || undefined,
                artist: undefined,
                synopsis: descriptionParts.join("\n\n"),
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(d.completionStatus),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const id = this.seriesId(sourceManga.mangaId);
        const url = `${API_URL}/product/forSeries/${id}?platform=web`;
        const result = await this.fetchJson(url);
        const chapters = [];
        for (const volume of result ?? []) {
            const vc = this.buildChapter(volume, sourceManga);
            if (vc)
                chapters.push(vc);
            for (const chapter of volume.chapters ?? []) {
                const cc = this.buildChapter(chapter, sourceManga);
                if (cc)
                    chapters.push(cc);
            }
        }
        // Upstream reverses the assembled list so newest appears first.
        chapters.reverse();
        return chapters;
    }
    async getChapterDetails(chapter) {
        const { comicId, requiresLogin } = this.parseChapterId(chapter.chapterId);
        if (requiresLogin) {
            throw new Error("Enter your credentials in the Kodansha app and purchase/register for this title to read.");
        }
        // Page list: GET /comic/{id}/pages -> [{ pageNumber, comicID }, ...]
        const listUrl = `${API_URL}/comic/${comicId}/pages`;
        const viewer = await this.fetchJson(listUrl);
        const pages = [];
        for (let i = 0; i < (viewer ?? []).length; i++) {
            const v = viewer[i];
            const innerId = v.comicID ?? comicId;
            // Each page image is resolved through a per-page endpoint returning { url }.
            const imgUrl = `${API_URL}/comic/${innerId}/pages/${i + 1}`;
            const imgResult = await this.fetchJson(imgUrl);
            if (imgResult.url)
                pages.push(imgResult.url);
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
    discoverUrl(sort, fromIndex) {
        const params = [
            `sort=${sort}`,
            "subCategory=0",
            "includeSeries=true",
            "showSpotLightInfo=true",
            "category=0",
            `fromIndex=${fromIndex}`,
            `count=${PAGE_LIMIT}`,
        ];
        return `${API_URL}/discover/v2?${params.join("&")}`;
    }
    parseEntries(result, fromIndex) {
        const items = [];
        for (const entry of result.response ?? []) {
            if (entry.type === "product")
                continue;
            const content = entry.content;
            if (!content || content.id == null || !content.readableUrl)
                continue;
            const mangaId = this.toSafeId(`${content.readableUrl}#${content.id}`);
            const thumbs = content.thumbnails ?? [];
            const imageUrl = thumbs.length > 0 ? (thumbs[thumbs.length - 1].url ?? "") : "";
            items.push({
                mangaId,
                imageUrl,
                title: content.title ?? "",
            });
        }
        const fullCount = result.status?.fullCount;
        const hasNextPage = fullCount != null && fromIndex + PAGE_LIMIT < fullCount;
        return { items, hasNextPage };
    }
    buildChapter(raw, sourceManga) {
        if (raw.id == null)
            return undefined;
        const priceType = raw.variants?.[0]?.priceType;
        const isPaid = priceType === "Paid";
        // Without authentication we cannot know purchase/login status, so treat
        // "Paid" as locked and "FreeForRegistered" as login-required.
        const isLocked = isPaid;
        const requiresLogin = priceType === "FreeForRegistered";
        const seriesUrl = raw.readable?.seriesReadableUrl ?? "";
        const volumeNumber = raw.volumeNumber ?? null;
        const chapterNumber = raw.chapterNumber ?? null;
        // chapterId encodes everything needed to resolve pages and a share URL:
        //   {comicId}#{seriesReadableUrl}:{volumeNumber}:{chapterNumber}:{requiresLogin01}
        const chapterId = this.toSafeId(`${raw.id}#${seriesUrl}:${volumeNumber}:${chapterNumber}:${requiresLogin ? "1" : "0"}`);
        const baseName = raw.name ?? "";
        const title = isLocked ? `🔒 ${baseName}` : baseName;
        return {
            chapterId,
            sourceManga,
            title,
            volume: volumeNumber ?? 0,
            chapNum: chapterNumber ?? 0,
            publishDate: this.parseDate(raw.publishDate),
            langCode: "🇬🇧",
        };
    }
    // mangaId is "{readableUrl}#{id}" (safe-encoded). Series API id is the fragment.
    seriesId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const hash = decoded.indexOf("#");
        return hash >= 0 ? decoded.slice(hash + 1) : decoded;
    }
    mangaUrl(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const hash = decoded.indexOf("#");
        const readableUrl = hash >= 0 ? decoded.slice(0, hash) : decoded;
        return `${BASE_URL}/series/${readableUrl.replace(/^\/+/, "")}`;
    }
    // chapterId is "{comicId}#{seriesUrl}:{vol}:{chap}:{login}" (safe-encoded).
    parseChapterId(chapterId) {
        const decoded = this.safeDecode(chapterId);
        const hash = decoded.indexOf("#");
        const comicId = hash >= 0 ? decoded.slice(0, hash) : decoded;
        const fragment = hash >= 0 ? decoded.slice(hash + 1) : "";
        const parts = fragment.split(":");
        const requiresLogin = parts[3] === "1";
        return { comicId, requiresLogin };
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
    stripHtml(html) {
        try {
            const dom = htmlparser2.parseDocument(html);
            return cheerio.load(dom).root().text().trim();
        }
        catch {
            return html.replace(/<[^>]*>/g, "").trim();
        }
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const d = new Date(value);
        return isNaN(d.getTime()) ? new Date(0) : d;
    }
    parseStatus(status) {
        switch (status) {
            case "Complete":
                return "Completed";
            case "Ongoing":
                return "Ongoing";
            default:
                return "Unknown";
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
    async fetchCheerio(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
    async fetchJson(url) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const text = Application.arrayBufferToUTF8String(data);
        return JSON.parse(text);
    }
}
export const Kodansha = new KodanshaExtension();
