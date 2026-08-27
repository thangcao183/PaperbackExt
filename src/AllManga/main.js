import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from "@paperback/types";
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { AllMangaSearchForm } from "./forms";
import { AllMangaSettingsForm, getImageQuality, getShowAdult } from "./settings";
const BASE_URL = "https://mkissa.to";
const API_URL = "https://api.mkissa.net/api";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
const IMAGE_CDN = "https://wp.youtube-anime.com";
const LIMIT = 20;
const URL_REGEX = /^https?:\/\/.*/;
const POPULAR_QUERY = "query ($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) { queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) { recommendations { anyCard { _id name thumbnail englishName } } } }";
const SEARCH_QUERY = "query ($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) { mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) { edges { _id name thumbnail englishName } } }";
const DETAILS_QUERY = "query ($id: String!) { manga(_id: $id) { _id name thumbnail description authors genres tags status altNames englishName } }";
const CHAPTERS_QUERY = "query ($id: String!, $showId: String!) { manga(_id: $id) { _id name availableChaptersDetail } episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) { episodeIdNum notes uploadDates } }";
class AllMangaInterceptor extends PaperbackInterceptor {
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
class AllMangaExtension {
    requestManager = new AllMangaInterceptor("main");
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
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
    async getSettingsForm() {
        return new AllMangaSettingsForm();
    }
    async getDiscoverSections() {
        return [
            { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
            { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        const itemType = section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
        let cards;
        let hasNextPage;
        if (section.id === "popular") {
            const data = await this.fetchGraphQL(POPULAR_QUERY, {
                type: "manga",
                size: LIMIT,
                dateRange: 0,
                page,
                allowAdult: getShowAdult(),
                allowUnknown: false,
            });
            const recs = data.queryPopular?.recommendations ?? [];
            cards = recs.map((r) => r.anyCard).filter((c) => c != null);
            hasNextPage = recs.length === LIMIT;
        }
        else {
            const data = await this.fetchGraphQL(SEARCH_QUERY, {
                search: { isManga: true, allowAdult: getShowAdult(), allowUnknown: false },
                size: LIMIT,
                page,
                translationType: "sub",
                countryOrigin: "ALL",
            });
            cards = data.mangas?.edges ?? [];
            hasNextPage = cards.length === LIMIT;
        }
        const items = cards.map((card) => ({
            type: itemType,
            mangaId: this.mangaIdFromCard(card),
            imageUrl: this.parseThumbnailUrl(card.thumbnail),
            title: card.englishName || card.name,
            metadata: undefined,
        }));
        return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = query.title.trim();
        const searchMeta = query.metadata
            ?.searchMeta;
        const sort = searchMeta?.sort?.[0];
        const country = searchMeta?.country?.[0];
        const includeGenres = searchMeta?.includeGenres ?? [];
        const excludeGenres = searchMeta?.excludeGenres ?? [];
        const search = {
            isManga: true,
            allowAdult: getShowAdult(),
            allowUnknown: false,
        };
        if (titleQuery.length > 0)
            search.query = titleQuery;
        if (sort && sort.length > 0)
            search.sortBy = sort;
        if (includeGenres.length > 0)
            search.genres = includeGenres;
        if (excludeGenres.length > 0)
            search.excludeGenres = excludeGenres;
        const data = await this.fetchGraphQL(SEARCH_QUERY, {
            search,
            size: LIMIT,
            page,
            translationType: "sub",
            countryOrigin: country && country.length > 0 ? country : "ALL",
        });
        const cards = data.mangas?.edges ?? [];
        const items = cards.map((card) => ({
            mangaId: this.mangaIdFromCard(card),
            imageUrl: this.parseThumbnailUrl(card.thumbnail),
            title: card.englishName || card.name,
            subtitle: undefined,
            metadata: undefined,
        }));
        return { items, metadata: cards.length === LIMIT ? { page: page + 1 } : undefined };
    }
    async getAdvancedSearchForm() {
        return new AllMangaSearchForm();
    }
    async getMangaDetails(mangaId) {
        const id = this.idFromMangaId(mangaId);
        const data = await this.fetchGraphQL(DETAILS_QUERY, { id });
        const manga = data.manga;
        let synopsis = this.stripHtml(manga.description ?? "");
        const altNames = manga.altNames ?? [];
        if (altNames.length > 0) {
            const header = synopsis.length === 0 ? "Alternative Titles:\n" : "\n\nAlternative Titles:\n";
            synopsis += header + altNames.map((n) => `\u2022 ${n.trim()}`).join("\n");
        }
        const author = manga.authors && manga.authors.length > 0 ? manga.authors[0].trim() : undefined;
        const genreNames = [...(manga.genres ?? []), ...(manga.tags ?? [])];
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
                primaryTitle: manga.englishName || manga.name,
                secondaryTitles: [],
                thumbnailUrl: this.parseThumbnailUrl(manga.thumbnail),
                author,
                artist: author,
                synopsis,
                contentRating: ContentRating.MATURE,
                status: this.parseStatus(manga.status),
                tagGroups,
                shareUrl: `${BASE_URL}/manga/${id}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const id = this.idFromMangaId(sourceManga.mangaId);
        const data = await this.fetchGraphQL(CHAPTERS_QUERY, {
            id,
            showId: `manga@${id}`,
        });
        const slug = this.titleToSlug(data.manga.name);
        const chapterNums = data.manga.availableChaptersDetail?.sub ?? [];
        const episodeMap = new Map();
        for (const info of data.episodeInfos ?? []) {
            episodeMap.set(String(info.episodeIdNum), info);
        }
        const chapters = [];
        for (const chapterNum of chapterNums) {
            const info = episodeMap.get(String(chapterNum));
            const title = info?.notes?.trim() ?? "";
            let name = `Chapter ${chapterNum}`;
            if (title.length > 0 && !/\d/.test(title))
                name += `: ${title}`;
            const chapterUrl = `/read/${id}/${slug}/chapter-${chapterNum}-sub`;
            chapters.push({
                chapterId: this.toSafeId(chapterUrl),
                sourceManga,
                title: name,
                volume: 0,
                chapNum: parseFloat(chapterNum) || 0,
                publishDate: this.parseDate(info?.uploadDates?.sub),
                langCode: "\ud83c\uddec\ud83c\udde7",
            });
        }
        return chapters;
    }
    async getChapterDetails(chapter) {
        const chapterUrl = this.chapterShareUrl(chapter.chapterId);
        const [response, data] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
        if (response.status === 404)
            throw new Error("Content not found");
        const html = this.injectPageListHooks(Application.arrayBufferToUTF8String(data));
        const inject = `
      new Promise(function(resolve){
        var start = Date.now();
        var t = setInterval(function(){
          if (window.__cap) { clearInterval(t); resolve(JSON.stringify(window.__cap)); }
          else if (Date.now() - start > 28000) { clearInterval(t); resolve("null"); }
        }, 250);
      });
    `;
        const result = await Application.executeInWebView({
            source: { html, baseUrl: chapterUrl, loadCSS: false, loadImages: false },
            inject,
            storage: { cookies: [] },
        });
        const payload = JSON.parse(String(result.result ?? "null"));
        const edges = payload?.chapterPages?.edges ?? [];
        if (edges.length === 0) {
            return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: [] };
        }
        let chosen = edges.find((edge) => {
            const urls = edge.pictureUrls ?? [];
            const sample = urls.length > 0 ? urls[0].url : undefined;
            return (sample && URL_REGEX.test(sample)) || edge.pictureUrlHead != null;
        });
        if (!chosen)
            chosen = edges[0];
        const serverUrl = chosen.pictureUrlHead;
        let imageDomain = "https://ytimgf.youtube-anime.com/";
        if (serverUrl) {
            imageDomain = URL_REGEX.test(serverUrl)
                ? serverUrl.replace(/\/$/, "") + "/"
                : "https://" + serverUrl.replace(/\/$/, "") + "/";
        }
        const quality = getImageQuality();
        const pages = [];
        for (const img of chosen.pictureUrls ?? []) {
            if (!img.url)
                continue;
            let url = URL_REGEX.test(img.url) ? img.url : imageDomain + img.url.replace(/^\//, "");
            if (quality !== "original") {
                const match = url.match(/^https?:\/\/([^#]+)/);
                if (match)
                    url = `${IMAGE_CDN}/${match[1]}?w=${quality}`;
            }
            pages.push(url);
        }
        return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }
    async getMangaShareUrl(mangaId) {
        return `${BASE_URL}/manga/${this.idFromMangaId(mangaId)}`;
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
    async fetchGraphQL(query, variables) {
        const [response, data] = await Application.scheduleRequest({
            url: API_URL,
            method: "POST",
            headers: { "content-type": "application/json", referer: `${BASE_URL}/` },
            body: JSON.stringify({ variables, query }),
        });
        if (response.status === 404)
            throw new Error("Content not found");
        const json = JSON.parse(Application.arrayBufferToUTF8String(data));
        return json.data;
    }
    mangaIdFromCard(card) {
        return this.toSafeId(`/manga/${card._id}/${this.titleToSlug(card.name)}`);
    }
    idFromMangaId(mangaId) {
        const decoded = this.safeDecode(mangaId);
        const parts = decoded.split("/");
        return parts[2] ?? decoded;
    }
    chapterShareUrl(chapterId) {
        const decoded = this.safeDecode(chapterId);
        const parts = decoded.split("/");
        const mangaId = parts[2] ?? "";
        const chapterSlug = parts[4] ?? "";
        return `${BASE_URL}/manga/${mangaId}/${chapterSlug}`;
    }
    /**
     * Prepend the page-list capture hooks into the document `<head>` of the HTML
     * we hand to the webview.
     *
     * Upstream #18189 moved these hooks out of the "run after page start" script
     * and into the served markup for two reasons:
     *
     * 1. **Ordering.** Injecting after the page has begun loading races the
     *    site's own bundle — if AllManga fetches the chapter payload before our
     *    override lands, `Response.json` / `JSON.parse` are already the originals
     *    and the payload is never captured (empty page list).
     * 2. **Iframe bypass.** The site probes `iframe.contentWindow` as an
     *    anti-automation check. Forcing `contentWindow` to `null` on every
     *    `<iframe>` created through `createElement`/`createElementNS` makes that
     *    probe fail closed, which is what the site expects from a plain browser
     *    here and keeps the reader navigating normally.
     */
    injectPageListHooks(html) {
        const script = `<script>
      (function(){
        window.__cap = null;
        var capture = function(obj){
          try {
            if (obj && obj.data && obj.data.chapterPages) { window.__cap = obj.data; }
            else if (obj && obj.chapterPages) { window.__cap = obj; }
          } catch(e){}
        };
        var orig = JSON.parse;
        JSON.parse = function(text){
          var obj = orig.apply(this, arguments);
          capture(obj);
          return obj;
        };
        // Upstream #18050: the site may read the GraphQL payload through
        // Response.json() (which never goes through JSON.parse), so hook it too.
        try {
          var originalJson = Response.prototype.json;
          Response.prototype.json = function(){
            return originalJson.call(this).then(function(data){
              capture(data);
              return data;
            });
          };
        } catch(e){}
        // Upstream #18189: neuter iframe contentWindow so the site's
        // anti-automation probe does not stall the reader.
        try {
          var hook = function(el){
            if (el && String(el.tagName).toUpperCase() === "IFRAME") {
              Object.defineProperty(el, "contentWindow", {
                get: function(){ return null; },
                configurable: false,
              });
            }
            return el;
          };
          ["createElement", "createElementNS"].forEach(function(key){
            var original = Document.prototype[key];
            Document.prototype[key] = function(){
              return hook(original.apply(this, arguments));
            };
          });
        } catch(e){}
      })();
    </script>`;
        // Prefer prepending inside <head> so the hooks run before any site script.
        const headMatch = html.match(/<head[^>]*>/i);
        if (headMatch?.index !== undefined) {
            const insertAt = headMatch.index + headMatch[0].length;
            return html.slice(0, insertAt) + script + html.slice(insertAt);
        }
        const htmlMatch = html.match(/<html[^>]*>/i);
        if (htmlMatch?.index !== undefined) {
            const insertAt = htmlMatch.index + htmlMatch[0].length;
            return html.slice(0, insertAt) + `<head>${script}</head>` + html.slice(insertAt);
        }
        return script + html;
    }
    titleToSlug(name) {
        return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
    parseThumbnailUrl(thumbnail) {
        if (!thumbnail)
            return "";
        if (URL_REGEX.test(thumbnail))
            return thumbnail;
        return `${THUMBNAIL_CDN}${thumbnail}?w=250`;
    }
    parseStatus(status) {
        const s = (status ?? "").toLowerCase();
        if (s.includes("releasing"))
            return "Ongoing";
        if (s.includes("finished"))
            return "Completed";
        return "Unknown";
    }
    parseDate(value) {
        if (!value)
            return new Date(0);
        const d = new Date(value);
        return isNaN(d.getTime()) ? new Date(0) : d;
    }
    stripHtml(html) {
        if (!html)
            return "";
        const dom = htmlparser2.parseDocument(html);
        const $ = cheerio.load(dom);
        return $.root().text().trim();
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
export const AllManga = new AllMangaExtension();
