import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { getHideNsfw, MangaGekoSettingsForm } from "./settings";
import { MangaGekoSearchForm } from "./forms";
const BASE_URL = "https://www.mgeko.cc";
class MangaGekoInterceptor extends PaperbackInterceptor {
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
export class MangaGekoExtension {
    requestManager = new MangaGekoInterceptor("main");
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
    async getSettingsForm() {
        return new MangaGekoSettingsForm();
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
    async getAdvancedSearchForm(query) {
        const meta = query.metadata;
        return new MangaGekoSearchForm(meta?.searchMeta);
    }
    async getDiscoverSectionItems(section, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const sort = section.id === "popular" ? "popular_all_time" : "latest";
        const safeMode = getHideNsfw() ? "1" : "0";
        const url = `${BASE_URL}/browse-comics/data/?page=${page}&sort=${sort}&safe_mode=${safeMode}`;
        const { mangas, hasNextPage } = await this.fetchBrowse(url);
        const itemType = section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
        const items = mangas.map((m) => ({
            type: itemType,
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            metadata: undefined,
        }));
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata?.searchMeta;
        const hasFilters = this.hasActiveFilters(searchMeta);
        // Text-only search uses the /search/ autocomplete page (HTML, .novel-item).
        if (titleQuery && !hasFilters) {
            const url = `${BASE_URL}/search/?search=${encodeURIComponent(titleQuery)}&results=${page}`;
            const $ = await this.fetchCheerio({ url, method: "GET" });
            const results = [];
            $(".novel-item").each((_, element) => {
                const el = $(element);
                const title = el.find(".novel-title").first().text().trim();
                const href = el.find("a").first().attr("href") || "";
                if (!title || !href)
                    return;
                const imageUrl = this.imageFromElement(el.find(".novel-cover img"));
                results.push({
                    mangaId: this.parsePath(href),
                    imageUrl,
                    title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            });
            const hasNextPage = $("nav.paging a:contains(Next)").length > 0;
            return {
                items: results,
                metadata: hasNextPage ? { page: page + 1 } : undefined,
            };
        }
        // Filter / advanced browse uses the browse-comics JSON endpoint.
        const url = this.buildBrowseUrl(titleQuery, searchMeta, page);
        const { mangas, hasNextPage } = await this.fetchBrowse(url);
        const results = mangas.map((m) => ({
            mangaId: m.mangaId,
            imageUrl: m.imageUrl,
            title: m.title,
            subtitle: undefined,
            metadata: undefined,
        }));
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    hasActiveFilters(meta) {
        if (!meta)
            return false;
        return ((meta.sort?.length ?? 0) > 0 ||
            (meta.status?.[0] ?? "") !== "" ||
            (meta.type?.[0] ?? "") !== "" ||
            (meta.includeGenres?.length ?? 0) > 0 ||
            (meta.excludeGenres?.length ?? 0) > 0 ||
            (meta.extras?.length ?? 0) > 0 ||
            (meta.tags ?? "").trim() !== "" ||
            (meta.minChapters ?? "").trim() !== "" ||
            (meta.maxChapters ?? "").trim() !== "" ||
            (meta.minRating ?? "").trim() !== "");
    }
    buildBrowseUrl(titleQuery, meta, page) {
        const params = [];
        const sort = meta?.sort?.[0] ?? "latest";
        params.push(`sort=${encodeURIComponent(sort)}`);
        const status = meta?.status?.[0] ?? "";
        if (status)
            params.push(`status=${encodeURIComponent(status)}`);
        const type = meta?.type?.[0] ?? "";
        if (type)
            params.push(`type=${encodeURIComponent(type)}`);
        const minChapters = (meta?.minChapters ?? "").trim();
        if (minChapters)
            params.push(`min_chapters=${encodeURIComponent(minChapters)}`);
        const maxChapters = (meta?.maxChapters ?? "").trim();
        if (maxChapters)
            params.push(`max_chapters=${encodeURIComponent(maxChapters)}`);
        const minRating = (meta?.minRating ?? "").trim();
        const ratingValue = parseFloat(minRating);
        if (minRating && !isNaN(ratingValue)) {
            params.push(`min_rating=${Math.trunc(ratingValue * 10)}`);
        }
        for (const extra of meta?.extras ?? []) {
            params.push(`${encodeURIComponent(extra)}=1`);
        }
        params.push(`safe_mode=${getHideNsfw() ? "1" : "0"}`);
        params.push(`page=${page}`);
        const include = meta?.includeGenres ?? [];
        if (include.length > 0)
            params.push(`include_genres=${encodeURIComponent(include.join(","))}`);
        const exclude = meta?.excludeGenres ?? [];
        if (exclude.length > 0)
            params.push(`exclude_genres=${encodeURIComponent(exclude.join(","))}`);
        const tags = (meta?.tags ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
        if (tags.length > 0)
            params.push(`tags=${encodeURIComponent(tags.join(","))}`);
        params.push(`q=${encodeURIComponent(titleQuery)}`);
        return `${BASE_URL}/browse-comics/data/?${params.join("&")}`;
    }
    async fetchBrowse(url) {
        const dto = await this.fetchJson({ url, method: "GET" });
        const html = dto.results_html ?? "";
        const dom = htmlparser2.parseDocument(html);
        const $ = cheerio.load(dom);
        const mangas = [];
        $(".comic-card").each((_, element) => {
            const el = $(element);
            const title = el.find(".comic-card__title a").first().text().trim();
            const href = el.find("a").first().attr("href") || "";
            if (!title || !href)
                return;
            const imageUrl = this.imageFromElement(el.find(".comic-card__cover img"));
            mangas.push({ mangaId: this.parsePath(href), title, imageUrl });
        });
        const page = dto.page ?? 1;
        const numPages = dto.num_pages ?? page;
        return { mangas, hasNextPage: page < numPages };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const author = $(".author a").first().attr("title")?.trim();
        const summary = $(".description").first().text().trim();
        const summaryText = summary.includes("Summary is")
            ? summary.substring(summary.indexOf("Summary is") + "Summary is".length)
            : summary;
        let synopsis = summaryText.trim();
        const altRaw = $(".alternative-title").first().clone();
        altRaw.children().remove();
        const altText = altRaw.text().trim();
        if (altText) {
            const altNames = altText
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t.length > 0 && t.toLowerCase() !== "updating");
            if (altNames.length > 0) {
                synopsis += `\n\nAlternative Name:`;
                for (const name of altNames)
                    synopsis += `\n- ${name}`;
            }
        }
        const genres = $(".categories a[href*=genre]")
            .map((_, el) => $(el).text().trim())
            .get()
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
        let status = "Unknown";
        if ($("div.header-stats strong.completed").length > 0)
            status = "Completed";
        else if ($("div.header-stats strong.ongoing").length > 0)
            status = "Ongoing";
        const thumbnailUrl = this.imageFromElement($(".cover img"));
        const cleanAuthor = author && author.toLowerCase() !== "updating" ? author : undefined;
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: $(".novel-title").first().text().trim() ||
                    $("h1").first().text().trim() ||
                    this.safeDecode(mangaId),
                secondaryTitles: [],
                thumbnailUrl,
                author: cleanAuthor,
                synopsis: synopsis.trim(),
                contentRating: ContentRating.MATURE,
                status,
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const base = this.mangaUrl(sourceManga.mangaId).replace(/\/+$/, "");
        const url = `${base}/all-chapters/`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const chapters = [];
        $("ul.chapter-list > li").each((_, element) => {
            const el = $(element);
            const href = el.find("a").first().attr("href") || "";
            if (!href)
                return;
            const chapterName = el
                .find(".chapter-title, .chapter-number")
                .first()
                .clone()
                .children()
                .remove()
                .end()
                .text()
                .trim()
                .replace(/-eng-li$/, "");
            const name = `Chapter ${chapterName}`;
            const dateText = el.find(".chapter-update").first().attr("datetime");
            chapters.push({
                chapterId: this.parsePath(href),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: this.parseChapterNumber(chapterName),
                publishDate: this.parseDate(dateText),
                langCode: "🇬🇧",
            });
        });
        return chapters;
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        $("#chapter-reader img").each((_, element) => {
            const src = $(element).attr("src") || "";
            if (!src)
                return;
            const absolute = this.absoluteUrl(src);
            // Upstream #18226: the reader appends a site-credits image that 404s,
            // which showed up as a broken final page.
            if (absolute.includes("credits-mgeko.png"))
                return;
            pages.push(absolute);
        });
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
    imageFromElement(el) {
        const dataSrc = el.first().attr("data-src") || "";
        const src = el.first().attr("src") || "";
        return this.absoluteUrl(dataSrc || src);
    }
    mangaUrl(mangaId) {
        const slug = this.safeDecode(mangaId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
        if (slug.startsWith("http"))
            return slug;
        return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
    }
    parsePath(href) {
        const decoded = this.safeDecode(href);
        const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
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
    parseChapterNumber(name) {
        const match = name.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : -1;
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
    parseDate(dateText) {
        if (!dateText)
            return new Date(0);
        const cleaned = dateText.replace(/\./g, "").replace("Sept", "Sep");
        const d = new Date(cleaned);
        return isNaN(d.getTime()) ? new Date(0) : d;
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
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error("Content not found");
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
}
export const MangaGeko = new MangaGekoExtension();
