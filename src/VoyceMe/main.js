import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
const BASE_URL = "https://www.voyce.me";
const GRAPHQL_URL = "https://graphql.voyce.me/v1/graphql";
const STATIC_URL = "https://dlkfxmdtxtzpb.cloudfront.net/";
const PER_PAGE = 10;
// ----------------------------------------------------------------
// GraphQL queries (ported verbatim from upstream)
// ----------------------------------------------------------------
const POPULAR_QUERY = `query($limit: Int, $offset: Int) {
  voyce_series(
    where: { publish: { _eq: 1 }, type: { id: { _in: [2, 4] } } },
    order_by: [{ views_counts: { count: desc_nulls_last } }],
    limit: $limit,
    offset: $offset
  ) { id slug thumbnail title }
}`;
const LATEST_QUERY = `query($limit: Int, $offset: Int) {
  voyce_series(
    where: { publish: { _eq: 1 }, type: { id: { _in: [2, 4] } } },
    order_by: [{ updated_at: desc }],
    limit: $limit,
    offset: $offset
  ) { id slug thumbnail title }
}`;
const SEARCH_QUERY = `query($searchTerm: String!, $limit: Int, $offset: Int) {
  voyce_series(
    where: {
      publish: { _eq: 1 },
      type: { id: { _in: [2, 4] } },
      title: { _ilike: $searchTerm }
    },
    order_by: [{ views_counts: { count: desc_nulls_last } }],
    limit: $limit,
    offset: $offset
  ) { id slug thumbnail title }
}`;
const DETAILS_QUERY = `query($slug: String!) {
  voyce_series(
    where: {
      publish: { _eq: 1 },
      type: { id: { _in: [2, 4] } },
      slug: { _eq: $slug }
    },
    limit: 1
  ) {
    id slug thumbnail title description status
    author { username }
    genres(order_by: [{ genre: { title: asc } }]) { genre { title } }
  }
}`;
const CHAPTERS_QUERY = `query($slug: String!) {
  voyce_series(
    where: {
      publish: { _eq: 1 },
      type: { id: { _in: [2, 4] } },
      slug: { _eq: $slug }
    },
    limit: 1
  ) {
    slug
    chapters(order_by: [{ created_at: desc }]) { id title created_at }
  }
}`;
const PAGES_QUERY = `query($chapterId: Int!) {
  voyce_chapter_images(
    where: { chapter_id: { _eq: $chapterId } },
    order_by: { sort_order: asc }
  ) { image }
}`;
class VoyceMeInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            "user-agent": await Application.getDefaultUserAgent(),
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
export class VoyceMeExtension {
    requestManager = new VoyceMeInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });
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
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const offset = (page - 1) * PER_PAGE;
        const query = section.id === "latest" ? LATEST_QUERY : POPULAR_QUERY;
        const series = await this.graphQLSeries(query, {
            limit: PER_PAGE,
            offset,
        });
        const items = [];
        for (const s of series) {
            const parsed = this.seriesToItem(s);
            if (!parsed)
                continue;
            items.push({
                type: section.id === "latest"
                    ? "simpleCarouselItem"
                    : "featuredCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: series.length === PER_PAGE ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const offset = (page - 1) * PER_PAGE;
        const titleQuery = (query.title || "").trim();
        const series = await this.graphQLSeries(SEARCH_QUERY, {
            searchTerm: `%${titleQuery}%`,
            limit: PER_PAGE,
            offset,
        });
        const results = [];
        for (const s of series) {
            const parsed = this.seriesToItem(s);
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
        return {
            items: results,
            metadata: series.length === PER_PAGE ? { page: page + 1 } : undefined,
        };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const slug = this.safeDecode(mangaId);
        const series = await this.graphQLSeries(DETAILS_QUERY, { slug });
        const comic = series[0];
        if (!comic) {
            throw new Error("Content not found");
        }
        const genreTitles = (comic.genres ?? [])
            .map((g) => (g.genre?.title ?? "").trim())
            .filter((t) => t.length > 0);
        const tagGroups = [];
        if (genreTitles.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genreTitles.map((t) => ({
                    id: t.toLowerCase().replace(/\s+/g, "-"),
                    title: t,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: comic.title || slug,
                secondaryTitles: [],
                thumbnailUrl: this.staticImage(comic.thumbnail),
                author: comic.author?.username || undefined,
                artist: comic.author?.username || undefined,
                synopsis: this.cleanText(comic.description ?? ""),
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(comic.status ?? ""),
                tagGroups,
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const slug = this.safeDecode(sourceManga.mangaId);
        const series = await this.graphQLSeries(CHAPTERS_QUERY, { slug });
        const comic = series[0];
        if (!comic)
            return [];
        const rawChapters = comic.chapters ?? [];
        const chapters = [];
        const seenNames = new Set();
        rawChapters.forEach((ch, index) => {
            if (ch.id === undefined || ch.id === null)
                return;
            const name = ch.title ?? "";
            if (seenNames.has(name))
                return;
            seenNames.add(name);
            chapters.push({
                chapterId: this.toSafeId(`${slug}/${ch.id}`),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: rawChapters.length - index,
                publishDate: this.parseDate(ch.created_at),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const chapterId = this.chapterNumericId(chapter.chapterId);
        const images = await this.graphQLImages(PAGES_QUERY, { chapterId });
        const pages = images
            .map((img) => this.staticImage(img.image))
            .filter((p) => p.length > 0);
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
    // GraphQL helpers
    // ----------------------------------------------------------------
    async graphQLSeries(query, variables) {
        const json = await this.graphQLPost(query, variables);
        const data = json.data;
        return data?.voyce_series ?? [];
    }
    async graphQLImages(query, variables) {
        const json = await this.graphQLPost(query, variables);
        const data = json
            .data;
        return data?.voyce_chapter_images ?? [];
    }
    async graphQLPost(query, variables) {
        const request = {
            url: GRAPHQL_URL,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query, variables }),
        };
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
    // ----------------------------------------------------------------
    // Mapping + parsing helpers
    // ----------------------------------------------------------------
    seriesToItem(s) {
        const slug = (s.slug ?? "").trim();
        const title = (s.title ?? "").trim();
        if (!slug || !title)
            return undefined;
        return {
            mangaId: this.toSafeId(slug),
            imageUrl: this.staticImage(s.thumbnail),
            title,
        };
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/series/${slug.replace(/^\/+/, "")}`;
    }
    chapterNumericId(chapterId) {
        const decoded = this.safeDecode(chapterId);
        const last = decoded.split("/").pop() ?? "";
        const id = parseInt(last.replace(/#.*$/, ""), 10);
        return Number.isNaN(id) ? 0 : id;
    }
    staticImage(path) {
        const p = (path ?? "").trim();
        if (!p)
            return "";
        if (p.startsWith("http"))
            return p;
        if (p.startsWith("//"))
            return `https:${p}`;
        return `${STATIC_URL}${p.replace(/^\/+/, "")}`;
    }
    parseStatus(status) {
        const s = (status || "").toLowerCase();
        if (s.includes("completed"))
            return "Completed";
        if (s.includes("ongoing"))
            return "Ongoing";
        return "Unknown";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const t = Date.parse(value);
        return Number.isNaN(t) ? new Date(0) : new Date(t);
    }
    cleanText(raw) {
        return raw
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .trim();
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
export const VoyceMe = new VoyceMeExtension();
