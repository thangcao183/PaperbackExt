import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://mangack.com";
const PAGE_SIZE = 24;
const IMG_SRC_REGEX = /<img[^>]+src=["']([^"']+)["']/g;
const SKIP_ASSET_REGEX = /(?:\/wp-content\/(?:themes|plugins)\/|\/(?:logo|icon|cropped|preroll|placeholder|loading|spinner|chainsaw)[^/]*\.(?:png|jpe?g|webp|gif|svg))/i;
const RELATIVE_NUMBER_REGEX = /^(\d+)/;
class MangackInterceptor extends PaperbackInterceptor {
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
export class MangackExtension {
    requestManager = new MangackInterceptor("main");
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
            return this.getGenreDiscoverItems();
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        if (section.id === "latest") {
            const path = page <= 1 ? "/updates/" : `/updates/page/${page}/`;
            const $ = await this.fetchCheerio({
                url: `${BASE_URL}${path}`,
                method: "GET",
            });
            const items = [];
            const seen = new Set();
            $(".latestmanga .Latest_chapter_update").each((_, element) => {
                const card = $(element);
                const link = card.find("a[href*='/manga/']").first();
                const href = link.attr("href") || "";
                if (!href)
                    return;
                const mangaId = this.parsePath(href);
                if (!mangaId || seen.has(mangaId))
                    return;
                seen.add(mangaId);
                const title = link.attr("title")?.trim() || link.text().trim() || mangaId;
                const imageUrl = this.imageFromElement(card.find("img").first());
                items.push({
                    type: "simpleCarouselItem",
                    mangaId,
                    imageUrl,
                    title,
                    metadata: undefined,
                });
            });
            const hasNextPage = $(".pagination a.next, a.next.page-numbers").length > 0;
            return {
                items,
                metadata: hasNextPage ? { page: page + 1 } : undefined,
            };
        }
        // popular -> WP REST manga list ordered by date desc
        const url = `${BASE_URL}/wp-json/wp/v2/manga?page=${page}` +
            `&per_page=${PAGE_SIZE}&_embed=wp:featuredmedia&orderby=date&order=desc`;
        const [list, nextPage] = await this.fetchMangaList(url, page);
        const items = list.map((m) => ({
            type: "featuredCarouselItem",
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
        }));
        return { items, metadata: nextPage ? { page: nextPage } : undefined };
    }
    async getGenreDiscoverItems() {
        const url = `${BASE_URL}/wp-json/wp/v2/Genres?per_page=100&hide_empty=true`;
        const terms = await this.fetchJson(url);
        const items = [];
        if (Array.isArray(terms)) {
            for (const term of terms) {
                if (typeof term.id !== "number" || !term.name)
                    continue;
                items.push({
                    type: "genresCarouselItem",
                    name: term.name,
                    searchQuery: {
                        title: "",
                        metadata: { genre: term.id.toString() },
                    },
                    metadata: undefined,
                });
            }
        }
        items.sort((a, b) => a.type === "genresCarouselItem" && b.type === "genresCarouselItem"
            ? a.name.localeCompare(b.name)
            : 0);
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata;
        const params = [];
        params.push(`page=${page}`);
        params.push(`per_page=${PAGE_SIZE}`);
        params.push(`_embed=wp:featuredmedia`);
        if (titleQuery)
            params.push(`search=${encodeURIComponent(titleQuery)}`);
        if (searchMeta?.genre)
            params.push(`Genres=${encodeURIComponent(searchMeta.genre)}`);
        const url = `${BASE_URL}/wp-json/wp/v2/manga?${params.join("&")}`;
        const [list, nextPage] = await this.fetchMangaList(url, page);
        const results = list.map((m) => ({
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items: results,
            metadata: nextPage ? { page: nextPage } : undefined,
        };
    }
    async fetchMangaList(url, page) {
        const [response, data] = await Application.scheduleRequest({
            url,
            method: "GET",
        });
        const json = this.parseJson(data);
        const list = [];
        if (Array.isArray(json)) {
            for (const dto of json) {
                const link = dto.link || "";
                if (!link)
                    continue;
                const mangaId = this.parsePath(link);
                if (!mangaId)
                    continue;
                const title = this.decodeEntities(dto.title?.rendered || "");
                const imageUrl = this.absoluteUrl(dto._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "");
                list.push({ mangaId, imageUrl, title: title || mangaId });
            }
        }
        const totalPages = parseInt(response.headers?.["x-wp-totalpages"] ||
            response.headers?.["X-WP-TotalPages"] ||
            "1", 10);
        const hasNext = !Number.isNaN(totalPages) && page < totalPages;
        return [list, hasNext ? page + 1 : undefined];
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const article = $("article").first();
        const articleClasses = (article.attr("class") || "").split(/\s+/);
        const title = $("h1.entry-title").first().text().trim() ||
            $("meta[property='og:title']")
                .first()
                .attr("content")
                ?.replace(/ mangack$/, "")
                .trim() ||
            this.safeDecode(mangaId);
        const thumbnailUrl = this.absoluteUrl($("meta[property='og:image']").first().attr("content") || "") ||
            this.imageFromElement(article.find("figure img, .mediumthumbnail1 img").first());
        const typeName = this.humanizeSlug(this.stripPrefix(articleClasses, "comic-type-"));
        const genreNames = articleClasses
            .filter((c) => c.startsWith("Genres-"))
            .map((c) => this.humanizeSlug(c.replace(/^Genres-/, "")))
            .filter((g) => g.length > 0);
        const statusSlug = this.stripPrefix(articleClasses, "manga-status-");
        const allTags = [...genreNames];
        if (typeName)
            allTags.push(typeName);
        const tagGroups = [];
        if (allTags.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: allTags.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                synopsis: this.buildDescription($),
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(statusSlug),
                tagGroups,
                shareUrl: url,
            },
        };
    }
    buildDescription($) {
        const synopsis = $("meta[property='og:description']").first().attr("content")?.trim() ||
            "";
        const infobox = new Map();
        $("table.infobox tr").each((_, tr) => {
            const row = $(tr);
            const label = row.find("td:first-child, th:first-child").first().text().trim();
            const rawValue = row
                .find("td:nth-child(2), th:nth-child(2)")
                .first()
                .text()
                .trim();
            const value = rawValue.includes("Warning") ? "" : rawValue;
            if (label)
                infobox.set(label, value);
        });
        const followText = [];
        $(".follow-text").each((_, el) => {
            followText.push($(el).text().trim());
        });
        const followers = followText.find((t) => /^Followers/i.test(t));
        const views = followText.find((t) => /^Views/i.test(t));
        const parts = [];
        if (synopsis)
            parts.push(synopsis);
        const alt = infobox.get("Alternative");
        if (alt)
            parts.push(`Alternative: ${alt}`);
        const year = infobox.get("Realized in");
        if (year)
            parts.push(`Year: ${year}`);
        if (followers)
            parts.push(followers);
        if (views)
            parts.push(views);
        return parts.join("\n\n");
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        const seen = new Set();
        $("ul.chapterslist li").each((_, element) => {
            const li = $(element);
            const link = li.find("a.title, a[href*='/chapter/']").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            const name = (this.ownText(link) || link.text()).trim();
            const date = this.parseChapterDate(li.find(".entry-date").first().text().trim());
            entries.push({ chapterId, name, date });
        });
        return entries.map((entry, index) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.name,
            volume: 0,
            chapNum: this.parseChapterNumber(entry.name, entries.length - index),
            publishDate: entry.date,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const slug = this.safeDecode(chapter.chapterId)
            .replace(/\/+$/, "")
            .split("/")
            .filter((s) => s.length > 0)
            .pop();
        const url = `${BASE_URL}/wp-json/wp/v2/chapter?slug=${encodeURIComponent(slug || "")}` +
            `&_fields=id,content`;
        const [, data] = await Application.scheduleRequest({ url, method: "GET" });
        const json = this.parseJson(data);
        const pages = [];
        if (Array.isArray(json) && json.length > 0) {
            const html = json[0]?.content?.rendered || "";
            let m;
            const re = new RegExp(IMG_SRC_REGEX.source, "g");
            while ((m = re.exec(html)) !== null) {
                const src = m[1];
                if (!src || SKIP_ASSET_REGEX.test(src))
                    continue;
                pages.push(this.absoluteUrl(src));
            }
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
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parsePath(href) {
        const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
        const slug = cleaned.startsWith("http")
            ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
            : cleaned.replace(/^\/+/, "");
        return this.toSafeId(slug);
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
    stripPrefix(classes, prefix) {
        const match = classes.find((c) => c.startsWith(prefix));
        return match ? match.slice(prefix.length) : "";
    }
    humanizeSlug(slug) {
        return slug
            .split("-")
            .filter((w) => w.length > 0)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
    }
    parseChapterNumber(name, fallback) {
        const m = name.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : fallback;
    }
    parseChapterDate(raw) {
        if (!raw)
            return new Date(0);
        const text = raw.toLowerCase();
        const numMatch = text.match(RELATIVE_NUMBER_REGEX);
        const number = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!Number.isNaN(number)) {
            let msPerUnit = 0;
            if (text.includes("second"))
                msPerUnit = 1000;
            else if (text.includes("minute"))
                msPerUnit = 60000;
            else if (text.includes("hour"))
                msPerUnit = 3600000;
            else if (text.includes("day"))
                msPerUnit = 86400000;
            else if (text.includes("week"))
                msPerUnit = 604800000;
            else if (text.includes("month"))
                msPerUnit = 2592000000;
            else if (text.includes("year"))
                msPerUnit = 31536000000;
            if (msPerUnit > 0) {
                return new Date(Date.now() - number * msPerUnit);
            }
        }
        const parsed = Date.parse(raw);
        return Number.isNaN(parsed) ? new Date(0) : new Date(parsed);
    }
    ownText(el) {
        const node = el.get(0);
        if (!node)
            return "";
        let text = "";
        for (const child of node.children ?? []) {
            if (child.type === "text") {
                text += child.data ?? "";
            }
        }
        return text.trim();
    }
    imageFromElement(img) {
        const srcset = img.attr("srcset") || "";
        const src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            (srcset ? srcset.split(" ")[0] : "") ||
            img.attr("src") ||
            "";
        return this.absoluteUrl(src);
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
    parseStatus(slug) {
        const s = (slug || "").toLowerCase();
        if (["ongoing", "publishing", "updating"].includes(s))
            return "Ongoing";
        if (["completed", "complete", "finished"].includes(s))
            return "Completed";
        if (["hiatus", "on-hiatus", "on-hold"].includes(s))
            return "Hiatus";
        if (["cancelled", "canceled", "dropped"].includes(s))
            return "Cancelled";
        return "Unknown";
    }
    decodeEntities(s) {
        return s.replace(/&(#?[a-zA-Z0-9]+);/g, (full, e) => {
            switch (e) {
                case "amp":
                    return "&";
                case "lt":
                    return "<";
                case "gt":
                    return ">";
                case "quot":
                    return '"';
                case "apos":
                case "#39":
                    return "'";
                case "nbsp":
                    return " ";
                case "hellip":
                    return "…";
                case "mdash":
                    return "—";
                case "ndash":
                    return "–";
                case "rsquo":
                case "#8217":
                    return "'";
                case "lsquo":
                case "#8216":
                    return "'";
                case "rdquo":
                case "#8221":
                    return '"';
                case "ldquo":
                case "#8220":
                    return '"';
                default:
                    if (e.startsWith("#")) {
                        const code = parseInt(e.slice(1), 10);
                        return Number.isNaN(code) ? full : String.fromCharCode(code);
                    }
                    return full;
            }
        });
    }
    parseJson(data) {
        try {
            return JSON.parse(Application.arrayBufferToUTF8String(data));
        }
        catch {
            return undefined;
        }
    }
    async fetchJson(url) {
        const [, data] = await Application.scheduleRequest({ url, method: "GET" });
        return this.parseJson(data);
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
}
export const Mangack = new MangackExtension();
