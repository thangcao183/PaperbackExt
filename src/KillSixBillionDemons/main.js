import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
const BASE_URL = "https://killsixbilliondemons.com";
const AUTHOR = "Abbadon";
const PAGES_ORDER = "?order=ASC";
const DESCRIPTION = `Q: What is this all about?
This is a webcomic! It's graphic novel style, meaning it's meant to be read in large chunks, but you can subject yourself to the agony of reading it a couple pages a week!

Q: Do you have a twitter/tumble machine? Just who the hell draws this thing anyway?
A mysterious comics goblin named Abbadon draws this mess. My twitter is @orbitaldropkick, my tumblr is orbitaldropkick.tumblr.com. If you're feeling dangerous, you can e-mail me at ksbdabbadon@gmail.com

Q: A webcomic, eh? When does it update?
Tuesday and Friday evenings (and occasionally weekends). Sometimes it will be up quite late on those days.

Q: Who's this YISUN guy that keeps getting talked about?
Someone has not read their Psalms and Spasms recently!

Q: Can I buy this book in a more traditional format?
You absolutely can. You can get your hands on a print copy of the first and second books from Image comics in your local comics shop or anywhere else you can get comics.`;
// Strips WordPress generated thumbnail dimensions, e.g. "-300x200" before the extension.
const WORDPRESS_THUMBNAIL_REGEX = /-\d+x\d+(?=\.(?:jpe?g|png|webp|gif)(?:\?.*)?$)/i;
class KillSixBillionDemonsInterceptor extends PaperbackInterceptor {
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
export class KillSixBillionDemonsExtension {
    requestManager = new KillSixBillionDemonsInterceptor("main");
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
                id: "books",
                title: "Books",
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(_section, _metadata) {
        const books = await this.fetchBooks();
        const items = [];
        for (const book of books) {
            const imageUrl = await this.fetchThumbnailUrl(book.mangaId);
            items.push({
                type: "simpleCarouselItem",
                mangaId: book.mangaId,
                imageUrl,
                title: book.title,
                metadata: undefined,
            });
        }
        return { items, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Search
    // ----------------------------------------------------------------
    async getSearchResults(query, _metadata) {
        const titleQuery = (query.title || "").trim().toLowerCase();
        const books = await this.fetchBooks();
        const results = [];
        for (const book of books) {
            if (titleQuery !== "" && !book.title.toLowerCase().includes(titleQuery)) {
                continue;
            }
            const imageUrl = await this.fetchThumbnailUrl(book.mangaId);
            results.push({
                mangaId: book.mangaId,
                imageUrl,
                title: book.title,
                subtitle: undefined,
                metadata: undefined,
            });
        }
        return { items: results, metadata: undefined };
    }
    // ----------------------------------------------------------------
    // Manga details
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const books = await this.fetchBooks();
        const book = books.find((b) => b.mangaId === mangaId);
        const title = book ? book.title : this.safeDecode(mangaId);
        const thumbnailUrl = await this.fetchThumbnailUrl(mangaId);
        const status = await this.fetchStatusForBook(title);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl,
                author: AUTHOR,
                artist: AUTHOR,
                synopsis: DESCRIPTION,
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
        const mangaPath = this.urlPath(this.mangaUrl(sourceManga.mangaId)).replace(/\/+$/, "");
        const chapters = [];
        let foundBook = false;
        let chapterIndex = 1;
        const options = $("#chapter option").toArray();
        for (const option of options) {
            const el = $(option);
            if (!this.isValidOption(el))
                continue;
            const text = el.text().trim();
            const value = el.attr("value") || "";
            if (this.isBookOption(el)) {
                if (foundBook) {
                    // Reached the next book, stop gathering chapters.
                    break;
                }
                const optionPath = this.urlPath(value).replace(/\/+$/, "");
                if (optionPath.toLowerCase() === mangaPath.toLowerCase()) {
                    foundBook = true;
                }
            }
            else if (foundBook) {
                const chapterId = this.parsePath(value);
                if (!chapterId)
                    continue;
                const chapterTitle = `Chapter ${text.split(" (")[0].trim()}`;
                chapters.push({
                    chapterId,
                    sourceManga,
                    title: chapterTitle,
                    volume: 0,
                    chapNum: chapterIndex++,
                    publishDate: new Date(0),
                    langCode: "🇬🇧",
                });
            }
        }
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const pages = [];
        const seen = new Set();
        let url = `${this.chapterUrl(chapter.chapterId)}${PAGES_ORDER}`;
        for (let i = 0; i < 100; i++) {
            const $ = await this.fetchCheerio({ url, method: "GET" });
            const thumbImgs = $(".comic-thumbnail-in-archive a img").toArray();
            if (thumbImgs.length > 0) {
                for (const img of thumbImgs) {
                    const src = $(img).attr("src") || "";
                    if (!src)
                        continue;
                    const imageUrl = this.absoluteUrl(src.replace(WORDPRESS_THUMBNAIL_REGEX, ""));
                    if (imageUrl)
                        pages.push(imageUrl);
                }
            }
            else {
                const src = $("#comic img").first().attr("src") || "";
                if (src) {
                    const imageUrl = this.absoluteUrl(src.replace(WORDPRESS_THUMBNAIL_REGEX, ""));
                    if (imageUrl)
                        pages.push(imageUrl);
                }
            }
            const nextUrl = $(".paginav-next a").first().attr("href") || "";
            if (!nextUrl)
                break;
            const absoluteNext = this.absoluteUrl(nextUrl);
            if (seen.has(absoluteNext))
                break;
            seen.add(absoluteNext);
            url = absoluteNext;
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
    // Book helpers (mirror the Kotlin fetchBooksAsMangas logic)
    // ----------------------------------------------------------------
    async fetchBooks() {
        const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
        const books = [];
        const seen = new Set();
        $("#chapter option").each((_, option) => {
            const el = $(option);
            if (!this.isBookOption(el))
                return;
            const value = el.attr("value") || "";
            if (!value)
                return;
            const mangaId = this.parsePath(value);
            if (!mangaId || seen.has(mangaId))
                return;
            seen.add(mangaId);
            const title = el.text().trim().split(" (")[0].trim();
            books.push({ mangaId, title });
        });
        return books;
    }
    async fetchThumbnailUrl(mangaId) {
        const url = `${this.mangaUrl(mangaId)}${PAGES_ORDER}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const src = $(".comic-thumbnail-in-archive a img").first().attr("src") || "";
        return this.absoluteUrl(src);
    }
    async fetchStatusForBook(bookTitle) {
        const bookTitleWithoutBook = bookTitle.includes(": ")
            ? bookTitle.split(": ").slice(1).join(": ")
            : bookTitle;
        const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });
        const postTitle = $(".post-title").first().text() || "";
        return postTitle
            .toLowerCase()
            .includes(bookTitleWithoutBook.toLowerCase())
            ? "Unknown"
            : "Completed";
    }
    isValidOption(el) {
        const text = el.text().trim();
        return el.attr("value") !== "0" && text.toLowerCase() !== "select chapter";
    }
    isBookOption(el) {
        if (!this.isValidOption(el))
            return false;
        const label = el.text().trim().split(" (")[0].trim();
        // Book options have non-numeric labels; chapter options are numeric.
        return label === "" || Number.isNaN(Number(label));
    }
    // ----------------------------------------------------------------
    // URL / id helpers
    // ----------------------------------------------------------------
    urlPath(url) {
        const decoded = this.safeDecode(url);
        if (decoded.startsWith("http")) {
            const match = decoded.match(/^https?:\/\/[^/]+(\/[^?#]*)/);
            return match ? match[1] : "/";
        }
        return decoded.replace(/[?#].*$/, "");
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
        const cleaned = decoded.replace(/[?#].*$/, "").replace(/\/+$/, "");
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
export const KillSixBillionDemons = new KillSixBillionDemonsExtension();
