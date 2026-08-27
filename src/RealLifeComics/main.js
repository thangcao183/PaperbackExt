import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://reallifecomics.com";
const LOGO = `${BASE_URL}/images/logo.png`;
const AUTHOR = "Maelyn Dean";
const SUMMARY = "The normal daily lives of some abnormal people. This entry includes all the chapters published in";
const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
};
const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];
class RealLifeComicsInterceptor extends PaperbackInterceptor {
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
export class RealLifeComicsExtension {
    requestManager = new RealLifeComicsInterceptor("main");
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
    // Yearly archive entries
    // ----------------------------------------------------------------
    currentYear() {
        return new Date().getFullYear();
    }
    // The source exposes one entry per yearly archive, mirroring the
    // upstream Kotlin: currentYear down to 1999, skipping 2016-2017.
    archiveYears() {
        const years = [];
        for (let year = this.currentYear(); year >= 1999; year--) {
            if (year >= 2016 && year <= 2017)
                continue;
            years.push(year);
        }
        return years;
    }
    mangaFromYear(year) {
        return {
            mangaId: this.toSafeId(`archivepage.php?year=${year}`),
            imageUrl: LOGO,
            title: `Real Life Comics (${year})`,
            subtitle: undefined,
            metadata: undefined,
        };
    }
    yearFromMangaId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const m = decoded.match(/year=(\d+)/);
        return m ? parseInt(m[1], 10) : undefined;
    }
    // ----------------------------------------------------------------
    // Discover sections
    // ----------------------------------------------------------------
    async getDiscoverSections() {
        return [
            {
                id: "archives",
                title: "Yearly Archives",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const items = this.archiveYears().map((year) => {
            const manga = this.mangaFromYear(year);
            return {
                type: "simpleCarouselItem",
                mangaId: manga.mangaId,
                imageUrl: manga.imageUrl,
                title: manga.title,
                metadata: undefined,
            };
        });
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const items = this.archiveYears()
            .map((year) => this.mangaFromYear(year))
            .filter((manga) => manga.title.toLowerCase().includes(titleQuery));
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const year = this.yearFromMangaId(mangaId);
        const title = year !== undefined ? `Real Life Comics (${year})` : "Real Life Comics";
        const status = year !== undefined && year !== this.currentYear()
            ? "Completed"
            : "Ongoing";
        const synopsis = year !== undefined ? `${SUMMARY} ${year}` : SUMMARY;
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl: LOGO,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis,
                contentRating: ContentRating.EVERYONE,
                status,
                tagGroups: [],
                shareUrl: this.mangaUrl(mangaId),
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const url = this.mangaUrl(sourceManga.mangaId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const entries = [];
        const seen = new Set();
        $(".calendar tbody tr td a").each((_index, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parsePath(href);
            if (!chapterId || seen.has(chapterId))
                return;
            seen.add(chapterId);
            // Entries between 1999-2014 do not have dates in the link, but
            // each calendar's preceding sibling holds the "Month Year" heading.
            const monthYear = el.closest(".calendar").prev().text().trim() || "";
            const dayText = el.text().trim();
            const rawDate = `${monthYear} ${dayText}`.trim();
            const time = this.parseDate(monthYear, dayText);
            const title = time.getTime() !== 0 ? this.formatName(time) : rawDate;
            entries.push({ chapterId, title, date: time });
        });
        return entries.map((entry, index) => ({
            chapterId: entry.chapterId,
            sourceManga,
            title: entry.title,
            volume: 0,
            chapNum: index,
            publishDate: entry.date,
            langCode: "🇬🇧",
        }));
    }
    async getChapterDetails(chapter) {
        const url = this.chapterUrl(chapter.chapterId);
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = [];
        const src = $(".comic img").first().attr("src") || "";
        if (src)
            pages.push(this.absoluteUrl(src));
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
    // Date helpers (mirror SimpleDateFormat "MMMM yyyy dd" parse and
    // "EEEE, MMM dd, yyyy" formatting from the upstream Kotlin)
    // ----------------------------------------------------------------
    parseDate(monthYear, dayText) {
        // monthYear is like "January 2024", dayText is the day-of-month.
        const my = monthYear.trim().split(/\s+/);
        if (my.length < 2)
            return new Date(0);
        const monthName = my[0].toLowerCase();
        const month = MONTHS[monthName];
        const year = parseInt(my[1], 10);
        const day = parseInt(dayText.trim(), 10);
        if (month === undefined || isNaN(year) || isNaN(day)) {
            return new Date(0);
        }
        return new Date(Date.UTC(year, month, day));
    }
    formatName(date) {
        const dayName = DAY_NAMES[date.getUTCDay()];
        const monthName = MONTH_NAMES[date.getUTCMonth()];
        const day = date.getUTCDate().toString().padStart(2, "0");
        const year = date.getUTCFullYear();
        return `${dayName}, ${monthName} ${day}, ${year}`;
    }
    // ----------------------------------------------------------------
    // Id / URL helpers
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
        const decoded = this.safeDecode(href);
        const slug = decoded.startsWith("http")
            ? decoded.replace(/^https?:\/\/[^/]+\//, "")
            : decoded.replace(/^\/+/, "");
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
export const RealLifeComics = new RealLifeComicsExtension();
