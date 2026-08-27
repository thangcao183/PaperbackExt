import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://myhentaicomics.com";
// Category (genre) browsing options ported from the upstream CategoryFilter.
const CATEGORIES = [
    { name: "3D Comic", id: "3" },
    { name: "Ahegao", id: "23" },
    { name: "Anal", id: "25" },
    { name: "Animated", id: "10" },
    { name: "Asian", id: "54" },
    { name: "Ass Expansion", id: "5" },
    { name: "Aunt", id: "6" },
    { name: "BBW", id: "7" },
    { name: "Beastiality", id: "8" },
    { name: "Bimbofication", id: "2049" },
    { name: "Bisexual", id: "9" },
    { name: "Black | Interracial", id: "20" },
    { name: "Body Swap", id: "11" },
    { name: "Bondage", id: "12" },
    { name: "Breast Expansion", id: "13" },
    { name: "Brother", id: "1012" },
    { name: "Bukkake", id: "15" },
    { name: "Catgirl", id: "1201" },
    { name: "Cbt", id: "8133" },
    { name: "Censored", id: "5136" },
    { name: "Cheating", id: "49" },
    { name: "Cosplay", id: "8157" },
    { name: "Cousin", id: "17" },
    { name: "CrimsonCoax", id: "11531" },
    { name: "Crossdressing", id: "43" },
    { name: "Cuntboy", id: "8134" },
    { name: "Dad | Father", id: "788" },
    { name: "Daughter", id: "546" },
    { name: "Dick Growth", id: "21" },
    { name: "Double Penetration", id: "8135" },
    { name: "Ebony", id: "29" },
    { name: "Elf", id: "1714" },
    { name: "Exhibitionism", id: "1838" },
    { name: "Family", id: "2094" },
    { name: "Femboy | Tomgirl | Sissy", id: "8136" },
    { name: "Femdom", id: "24" },
    { name: "Foot Fetish", id: "1873" },
    { name: "Forced", id: "18" },
    { name: "Furry", id: "14" },
    { name: "Futanari | Shemale | Dickgirl", id: "19" },
    { name: "Futanari X Female", id: "1951" },
    { name: "Futanari X Futanari", id: "1885" },
    { name: "Futanari X Male", id: "26" },
    { name: "Gangbang", id: "27" },
    { name: "Gay | Yaoi", id: "28" },
    { name: "Gender Bender", id: "16" },
    { name: "Giant", id: "8137" },
    { name: "Giantess", id: "452" },
    { name: "Gilf", id: "8138" },
    { name: "Gloryhole", id: "31" },
    { name: "Group", id: "101" },
    { name: "Hairy Female", id: "1986" },
    { name: "Hardcore", id: "36" },
    { name: "Harem", id: "53" },
    { name: "Inflation | Stomach Bulge", id: "57" },
    { name: "Inseki", id: "1978" },
    { name: "Kemonomimi", id: "1875" },
    { name: "Lactation", id: "39" },
    { name: "Legendary", id: "6293" },
    { name: "Lesbian | Yuri | Girls Only", id: "41" },
    { name: "Milf", id: "30" },
    { name: "Mind Break", id: "2023" },
    { name: "Mind Control | Hypnosis", id: "42" },
    { name: "Mom | Mother", id: "56" },
    { name: "Monster", id: "8140" },
    { name: "Monster Girl", id: "8139" },
    { name: "Most Popular", id: "52" },
    { name: "Muscle Girl", id: "45" },
    { name: "Muscle Growth", id: "46" },
    { name: "Nephew", id: "47" },
    { name: "Niece", id: "48" },
    { name: "Nipple Fuck | Nipple Penetration", id: "8141" },
    { name: "Pegging", id: "50" },
    { name: "Possession", id: "51" },
    { name: "Pregnant | Impregnation", id: "55" },
    { name: "Public Use", id: "8142" },
    { name: "Selfcest", id: "8143" },
    { name: "Sister", id: "58" },
    { name: "Slave", id: "8144" },
    { name: "Smegma", id: "8145" },
    { name: "Solo", id: "1865" },
    { name: "Solo Futa", id: "8154" },
    { name: "Solo Girl", id: "8146" },
    { name: "Solo Male", id: "8147" },
    { name: "Son", id: "62" },
    { name: "Spanking", id: "38" },
    { name: "Speechless", id: "8148" },
    { name: "Strap-On", id: "61" },
    { name: "Stuck In Wall", id: "8149" },
    { name: "Superheroes", id: "59" },
    { name: "Tentacles", id: "60" },
    { name: "Threesome", id: "40" },
    { name: "Tickling", id: "2065" },
    { name: "Titty Fuck | Paizuri", id: "8150" },
    { name: "Tomboy", id: "8153" },
    { name: "Transformation", id: "37" },
    { name: "Uncle", id: "63" },
    { name: "Urination", id: "64" },
    { name: "Vanilla | Wholesome", id: "8151" },
    { name: "Variant Set", id: "8152" },
    { name: "Vore | Unbirth", id: "65" },
    { name: "Weight Gain", id: "66" },
];
class MyHentaiComicsInterceptor extends PaperbackInterceptor {
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
export class MyHentaiComicsExtension {
    requestManager = new MyHentaiComicsInterceptor("main");
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
                id: "views",
                title: "Most Viewed",
                type: DiscoverSectionType.featured,
            },
            {
                id: "gallery",
                title: "Newest",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "favorites",
                title: "Most Favorited",
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: "categories",
                title: "Categories",
                type: DiscoverSectionType.genres,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        if (section.id === "categories") {
            const items = CATEGORIES.map((cat) => ({
                type: "genresCarouselItem",
                searchQuery: {
                    title: "",
                    metadata: { category: cat.id },
                },
                name: cat.name,
                metadata: undefined,
            }));
            return { items, metadata: undefined };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const url = `${BASE_URL}/${section.id}/${page}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        const seen = new Set();
        $("li.item:not(.image-block) .comic-inner a").each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            items.push({
                type: section.id === "views"
                    ? "featuredCarouselItem"
                    : "simpleCarouselItem",
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                metadata: undefined,
            });
        });
        const hasNextPage = $("li.next a").length > 0;
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const titleQuery = (query.title || "").trim();
        const searchMeta = query.metadata;
        const categoryId = searchMeta?.category;
        let url;
        if (titleQuery !== "") {
            // Text search takes priority and ignores all filters.
            url = `${BASE_URL}/search/${page}?query=${encodeURIComponent(titleQuery)}`;
        }
        else if (categoryId) {
            url = `${BASE_URL}/gallery/category/${categoryId}/${page}`;
        }
        else {
            url = `${BASE_URL}/gallery/${page}`;
        }
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        const seen = new Set();
        $("li.item:not(.image-block) .comic-inner a").each((_, element) => {
            const parsed = this.itemFromElement($, $(element));
            if (!parsed)
                return;
            if (seen.has(parsed.mangaId))
                return;
            seen.add(parsed.mangaId);
            results.push({
                mangaId: parsed.mangaId,
                imageUrl: parsed.imageUrl,
                title: parsed.title,
                subtitle: undefined,
                metadata: undefined,
            });
        });
        const hasNextPage = $("li.next a").length > 0;
        return {
            items: results,
            metadata: hasNextPage ? { page: page + 1 } : undefined,
        };
    }
    itemFromElement($, el) {
        const href = el.attr("href") || "";
        if (!href)
            return undefined;
        const mangaId = this.parsePath(href);
        if (!mangaId)
            return undefined;
        const title = el.find("h2.comic-name").first().text().trim();
        const imageUrl = this.imageFromElement(el.find("img").first());
        if (!title)
            return undefined;
        return { mangaId, imageUrl, title };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = this.mangaUrl(mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const desc = $("div.comic-description").first();
        const categories = desc
            .find("a[href*='/gallery/category/']")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0);
        const artists = desc
            .find("a[href*='/gallery/artist/']")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0);
        const groups = desc
            .find("a[href*='/gallery/group/']")
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 0);
        let pagesText = "";
        desc.find("div").each((_, el) => {
            const own = $(el).clone().children().remove().end().text().trim();
            if (own.startsWith("Pages:")) {
                pagesText = $(el).text().trim();
                return false;
            }
            return undefined;
        });
        const title = desc.find("h1").first().text().trim() || this.safeDecode(mangaId);
        const thumbnailUrl = this.imageFromElement($("div.comic-cover img").first());
        const synopsisLines = [];
        if (artists.length > 0)
            synopsisLines.push(`Artists: ${artists.join(", ")}`);
        if (groups.length > 0)
            synopsisLines.push(`Groups: ${groups.join(", ")}`);
        if (pagesText)
            synopsisLines.push(pagesText);
        const synopsis = synopsisLines.join("\n").trim();
        const tagGroups = [];
        const allTags = [...categories, ...artists, ...groups];
        if (allTags.length > 0) {
            tagGroups.push({
                id: "tags",
                title: "Tags",
                tags: allTags.map((t) => ({
                    id: t.toLowerCase().replace(/\s+/g, "-"),
                    title: t,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                artist: artists.join(", ") || undefined,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: "Completed",
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const firstPageHref = $("div.comic-cover a").first().attr("href") || "";
        if (!firstPageHref)
            return [];
        const abs = this.absoluteUrl(firstPageHref);
        const comicId = abs.split("/gallery/show/")[1]?.split("/")[0] || "";
        if (!comicId)
            return [];
        const chapterId = this.parsePath(`/gallery/show/${comicId}/1`);
        return [
            {
                chapterId,
                sourceManga,
                title: "Chapter 1",
                volume: 0,
                chapNum: 1,
                publishDate: new Date(0),
                langCode: "🇬🇧",
            },
        ];
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const comicId = url.split("/gallery/show/")[1]?.split("/")[0] || "";
        const imageUrl = $("ul.gallery-slide li img").first().attr("src") || "";
        if (!imageUrl) {
            return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: [] };
        }
        const absImage = this.absoluteUrl(imageUrl);
        // absImage = ".../images/The Mayor 6/original/001.jpg?22"
        const lastSlash = absImage.lastIndexOf("/");
        const imageBase = absImage.substring(0, lastSlash + 1);
        const fileName = absImage.substring(lastSlash + 1); // "001.jpg?22"
        const dot = fileName.indexOf(".");
        const fileExtension = dot >= 0 ? fileName.substring(dot + 1) : "jpg"; // "jpg?22"
        let totalPages = 1;
        $(`ul li a[href*='/gallery/show/${comicId}/']`).each((_, el) => {
            const href = $(el).attr("href") || "";
            const seg = href.substring(href.lastIndexOf("/") + 1);
            const num = parseInt(seg, 10);
            if (!isNaN(num) && num > totalPages)
                totalPages = num;
        });
        const pages = [];
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const padded = pageNum.toString().padStart(3, "0");
            pages.push(this.encodeSpaces(`${imageBase}${padded}.${fileExtension}`));
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
    chapterUrl(chapterId) {
        const slug = this.safeDecode(chapterId);
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
    imageFromElement(img) {
        const src = img.attr("data-src") ||
            img.attr("data-lazy-src") ||
            img.attr("data-cfsrc") ||
            img.attr("src") ||
            "";
        return this.encodeSpaces(this.absoluteUrl(src));
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
    encodeSpaces(url) {
        return url.replace(/ /g, "%20");
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
export const MyHentaiComics = new MyHentaiComicsExtension();
