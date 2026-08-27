import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { KappaBeastSearchForm } from "./forms";
const DOMAIN = "kappabeast.com";
const BASE_URL = `https://${DOMAIN}`;
const CDN_URL = `https://strapi.${DOMAIN}`;
const API_URL = `${CDN_URL}/api`;
const PAGE_SIZE = 20;
class KappaBeastInterceptor extends PaperbackInterceptor {
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
class KappaBeastExtension {
    requestManager = new KappaBeastInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 3,
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
        const sort = section.id === "latest" ? "updatedAt:desc" : "";
        const url = this.buildSearchUrl("", page, { sort: sort ? [sort] : [] });
        const result = await this.fetchJson({ url, method: "GET" });
        const items = result.data.map((m) => ({
            type: section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem",
            mangaId: this.toSafeId(`${m.slug}#${m.documentId}`),
            imageUrl: this.coverUrl(m),
            title: m.title,
            metadata: undefined,
        }));
        const hasNext = result.meta.pagination.page < result.meta.pagination.pageCount;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = query.title.trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        const url = this.buildSearchUrl(titleQuery, page, searchMeta);
        const result = await this.fetchJson({ url, method: "GET" });
        const items = result.data.map((m) => ({
            mangaId: this.toSafeId(`${m.slug}#${m.documentId}`),
            imageUrl: this.coverUrl(m),
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        const hasNext = result.meta.pagination.page < result.meta.pagination.pageCount;
        return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new KappaBeastSearchForm(meta);
    }
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId).split("#")[0].split("/")[0];
        const url = `${API_URL}/mangas?` +
            [
                `filters[slug][$eq]=${encodeURIComponent(slug)}`,
                "populate[media][populate]=*",
                "populate[category][fields][0]=name",
                "pagination[pageSize]=1",
            ].join("&");
        const result = await this.fetchJson({ url, method: "GET" });
        const manga = result.data[0];
        if (!manga)
            throw new Error("Manga not found");
        const genreNames = (manga.category ?? []).map((c) => c.name).filter((n) => n.length > 0);
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
                primaryTitle: manga.title,
                secondaryTitles: [],
                thumbnailUrl: this.coverUrl(manga),
                author: manga.author && manga.author.trim().length > 0 ? manga.author.trim() : undefined,
                artist: manga.artist && manga.artist.trim().length > 0 ? manga.artist.trim() : undefined,
                synopsis: (manga.description ?? "").trim(),
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(manga.manga_status),
                tagGroups,
                shareUrl: `${BASE_URL}/series/${manga.slug}#${manga.documentId}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const documentId = this.safeDecode(sourceManga.mangaId).split("#")[1];
        if (!documentId)
            throw new Error("Invalid manga id");
        const chapters = [];
        let page = 1;
        for (let guard = 0; guard < 100; guard++) {
            const url = `${API_URL}/chapters?` +
                [
                    `filters[manga][documentId][$eq]=${encodeURIComponent(documentId)}`,
                    "populate[pages][populate]=*",
                    "populate=manga",
                    "sort[0]=number:desc",
                    `pagination[page]=${page}`,
                    "pagination[pageSize]=100",
                ].join("&");
            const result = await this.fetchJson({ url, method: "GET" });
            for (const ch of result.data) {
                const numStr = ch.number % 1 === 0 ? String(Math.trunc(ch.number)) : String(ch.number);
                let name = `Chapter ${numStr}`;
                if (ch.title && ch.title.trim().length > 0 && ch.title !== `Chapter ${numStr}`) {
                    name += ` - ${ch.title.trim()}`;
                }
                chapters.push({
                    chapterId: this.toSafeId(`${ch.manga.slug}/${ch.number}#${ch.manga.documentId}`),
                    sourceManga,
                    title: name,
                    volume: 0,
                    chapNum: ch.number,
                    publishDate: this.parseDate(ch.createdAt),
                    langCode: "\ud83c\uddec\ud83c\udde7",
                });
            }
            if (result.meta.pagination.page >= result.meta.pagination.pageCount)
                break;
            page++;
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const documentId = decoded.split("#")[1];
        const chapterNum = decoded.split("#")[0].split("/")[1];
        const url = `${API_URL}/chapters?` +
            [
                `filters[manga][documentId][$eq]=${encodeURIComponent(documentId ?? "")}`,
                `filters[number][$eq]=${encodeURIComponent(chapterNum ?? "")}`,
                "populate[pages][populate]=*",
                "populate=manga",
                "sort[0]=number:desc",
                "pagination[pageSize]=1",
            ].join("&");
        const result = await this.fetchJson({ url, method: "GET" });
        const html = result.data[0]?.htmlContent;
        if (!html)
            throw new Error("This chapter contains no pages.");
        const $ = cheerio.load(htmlparser2.parseDocument(html));
        const pages = [];
        $("div.separator > a").each((_i, el) => {
            const href = $(el).attr("href");
            if (href)
                pages.push(this.setPathSegment(this.absoluteUrl(href), 4, "s0"));
        });
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
    buildSearchUrl(titleQuery, page, searchMeta) {
        const params = [];
        if (titleQuery.length > 0) {
            params.push(`filters[title][$containsi]=${encodeURIComponent(titleQuery)}`);
        }
        params.push(`pagination[page]=${page}`);
        params.push(`pagination[pageSize]=${PAGE_SIZE}`);
        params.push("populate[media][populate]=*");
        params.push("populate[category][fields][0]=name");
        const genre = searchMeta?.genre?.[0];
        const status = searchMeta?.status?.[0];
        const type = searchMeta?.type?.[0];
        const sort = searchMeta?.sort?.[0];
        if (genre && genre.length > 0) {
            params.push(`filters[category][name][$eq]=${encodeURIComponent(genre)}`);
        }
        if (status && status.length > 0) {
            params.push(`filters[manga_status][$eq]=${encodeURIComponent(status)}`);
        }
        if (type && type.length > 0) {
            params.push(`filters[type][$eq]=${encodeURIComponent(type)}`);
        }
        if (sort && sort.length > 0) {
            params.push(`sort[0]=${encodeURIComponent(sort)}`);
        }
        return `${API_URL}/mangas?${params.join("&")}`;
    }
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404)
            throw new Error("Content not found");
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
    coverUrl(manga) {
        const path = manga.media?.[0]?.coverImage?.url;
        if (!path)
            return "";
        return /^https?:\/\//.test(path) ? path : `${CDN_URL}${path}`;
    }
    absoluteUrl(src) {
        if (/^https?:\/\//.test(src))
            return src;
        if (src.startsWith("//"))
            return `https:${src}`;
        if (src.startsWith("/"))
            return `${BASE_URL}${src}`;
        return `${BASE_URL}/${src}`;
    }
    setPathSegment(url, index, value) {
        try {
            const match = url.match(/^(https?:\/\/[^/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/);
            if (!match)
                return url;
            const origin = match[1];
            const path = match[2] ?? "";
            const queryHash = (match[3] ?? "") + (match[4] ?? "");
            const segments = path.split("/");
            // segments[0] is "" (leading slash). Strapi setPathSegment is 0-indexed over path segments.
            const segIndex = index + 1;
            if (segIndex < segments.length) {
                segments[segIndex] = value;
            }
            return origin + segments.join("/") + queryHash;
        }
        catch {
            return url;
        }
    }
    parseStatus(status) {
        const s = (status ?? "").toLowerCase();
        if (s === "ongoing")
            return "Ongoing";
        if (s === "completed")
            return "Completed";
        return "Unknown";
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
export const KappaBeast = new KappaBeastExtension();
