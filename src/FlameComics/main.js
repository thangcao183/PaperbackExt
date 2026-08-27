import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from '@paperback/types';
import * as cheerio from 'cheerio';
import * as htmlparser2 from 'htmlparser2';
const BASE_URL = 'https://flamecomics.xyz';
const CDN = 'https://cdn.flamecomics.xyz';
const ITEMS_PER_PAGE = 20;
const SPECIAL_CHARS = /[^A-Za-z0-9 ]/g;
class FlameComicsInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            'user-agent': await Application.getDefaultUserAgent(),
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.5',
        };
        return request;
    }
    async interceptResponse(request, response, data) {
        if (response.headers?.['cf-mitigated'] === 'challenge') {
            throw new CloudflareError({
                url: request.url,
                method: request.method ?? 'GET',
                headers: { 'user-agent': await Application.getDefaultUserAgent() },
            });
        }
        return data;
    }
}
export class FlameComicsExtension {
    requestManager = new FlameComicsInterceptor('main');
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: 'stateManager' });
    globalRateLimiter = new BasicRateLimiter('rateLimiter', {
        numberOfRequests: 2,
        bufferInterval: 2,
        ignoreImages: true,
    });
    buildId = '';
    // Cache the (large) browse listing so search keystrokes and pagination
    // don't re-download it on every call. Searching/paging is done entirely
    // client-side over this list, and the 2-req/2-sec rate limiter otherwise
    // serializes dozens of identical browse.json fetches, making search feel
    // unreliable (late/empty results while typing).
    browseCache;
    static BROWSE_TTL_MS = 5 * 60 * 1000;
    async initialise() {
        this.requestManager.registerInterceptor();
        this.cookieStorageInterceptor.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
    }
    async getDiscoverSections() {
        return [
            { id: 'popular_section', title: 'Popular', type: DiscoverSectionType.featured },
            { id: 'latest_section', title: 'Latest Updates', type: DiscoverSectionType.simpleCarousel },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        if (section.id === 'latest_section') {
            const data = await this.fetchData('index.json');
            const series = data.pageProps?.latestEntries?.blocks?.[0]?.series ?? [];
            const items = series
                .filter((s) => s.series_id != null)
                .map((s) => this.seriesToDiscoverItem(s, 'simpleCarouselItem'));
            return { items, metadata: undefined };
        }
        const series = (await this.getBrowseSeries())
            .slice()
            .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = Math.min(page * ITEMS_PER_PAGE, series.length);
        const items = series.slice(start, end).map((s) => this.seriesToDiscoverItem(s, 'featuredCarouselItem'));
        return { items, metadata: end < series.length ? { page: page + 1 } : undefined };
    }
    async getSearchResults(query, metadata) {
        const page = metadata?.page ?? 1;
        const titleQuery = query.title?.trim() ?? '';
        let series = await this.getBrowseSeries();
        if (titleQuery) {
            const norm = titleQuery.toLowerCase().replace(SPECIAL_CHARS, '');
            series = series.filter((s) => {
                const titles = [s.title, ...(s.altTitles ?? [])];
                return titles.some((t) => t && t.toLowerCase().replace(SPECIAL_CHARS, '').includes(norm));
            });
        }
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = Math.min(page * ITEMS_PER_PAGE, series.length);
        const items = series.slice(start, end).map((s) => this.seriesToSearchItem(s));
        return { items, metadata: end < series.length ? { page: page + 1 } : undefined };
    }
    async getMangaDetails(mangaId) {
        const seriesId = this.safeDecode(mangaId);
        const data = await this.fetchData(`series/${seriesId}.json?id=${encodeURIComponent(seriesId)}`);
        const s = data.pageProps.series;
        const genres = s.tags ? [s.type, ...s.tags] : [s.type];
        const tags = genres
            .filter((g) => !!g)
            .map((g) => ({ id: this.tagId(g), title: g }));
        const tagGroups = tags.length
            ? [{ id: 'genres', title: 'Genres', tags }]
            : [];
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: s.title,
                secondaryTitles: s.altTitles ?? [],
                thumbnailUrl: this.thumbnailUrl(s),
                author: s.author?.join(', '),
                artist: s.artist?.join(', '),
                synopsis: this.stripHtml(s.description),
                contentRating: ContentRating.EVERYONE,
                status: this.parseStatus(s.status),
                tagGroups,
                shareUrl: `${BASE_URL}/series/${seriesId}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const seriesId = this.safeDecode(sourceManga.mangaId);
        const data = await this.fetchData(`series/${seriesId}.json?id=${encodeURIComponent(seriesId)}`);
        return data.pageProps.chapters.map((ch) => {
            // The API returns `chapter` as a string like "214.00"; coerce to a
            // number so Paperback can decode chapNum as a Double, and format a
            // clean label ("214", "97.5").
            const chapNum = Number(ch.chapter);
            const safeNum = Number.isFinite(chapNum) ? chapNum : 0;
            const chapStr = Number.isFinite(chapNum)
                ? String(chapNum)
                : String(ch.chapter);
            let title = `Chapter ${chapStr}`;
            if (ch.title && ch.title.trim()) {
                title += ` - ${ch.title.trim()}`;
            }
            return {
                chapterId: this.toSafeId(`${ch.series_id}/${ch.token}`),
                sourceManga,
                title,
                volume: 0,
                chapNum: safeNum,
                publishDate: new Date(ch.release_date * 1000),
                langCode: '🇬🇧',
            };
        });
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const slashIndex = decoded.indexOf('/');
        const seriesId = decoded.substring(0, slashIndex);
        const token = decoded.substring(slashIndex + 1);
        const data = await this.fetchData(`series/${seriesId}/${token}.json?id=${encodeURIComponent(seriesId)}&token=${encodeURIComponent(token)}`);
        const ch = data.pageProps.chapter;
        const images = Object.values(ch.images ?? {});
        const pages = images.map((p) => `${CDN}/uploads/images/series/${ch.series_id}/${ch.token}/${p.name}?${ch.release_date}`);
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
        const now = Date.now();
        for (const cookie of cookies) {
            if (!cookie.expires || cookie.expires.getTime() > now) {
                this.cookieStorageInterceptor.setCookie(cookie);
            }
        }
    }
    // --- Helpers ---
    seriesToDiscoverItem(s, type) {
        return {
            type,
            mangaId: String(s.series_id),
            imageUrl: this.thumbnailUrl(s),
            title: s.title,
            metadata: undefined,
        };
    }
    seriesToSearchItem(s) {
        return {
            mangaId: String(s.series_id),
            title: s.title,
            imageUrl: this.thumbnailUrl(s),
            subtitle: undefined,
            metadata: undefined,
        };
    }
    thumbnailUrl(s) {
        return `${CDN}/uploads/images/series/${s.series_id}/${s.cover}?${s.last_edit}#thumbnail`;
    }
    // Build a Paperback-safe tag id (allowed charset is alphanumeric plus
    // `._-@()[]%?#+=/&:`; spaces and other characters are not permitted).
    tagId(genre) {
        const slug = genre
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]/g, '');
        return slug || genre.toLowerCase().replace(/[^a-z0-9]/g, '') || 'tag';
    }
    parseStatus(status) {
        switch (status.toLowerCase()) {
            case 'ongoing':
                return 'Ongoing';
            case 'dropped':
                return 'Cancelled';
            case 'hiatus':
                return 'Hiatus';
            case 'completed':
                return 'Completed';
            default:
                return 'Unknown';
        }
    }
    stripHtml(html) {
        if (!html) {
            return '';
        }
        const dom = htmlparser2.parseDocument(html);
        const $ = cheerio.load(dom);
        return $.root().text().trim();
    }
    toSafeId(slug) {
        return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
            const enc = encodeURIComponent(c);
            return enc !== c ? enc : '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
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
    async getBuildId(forceRefresh = false) {
        if (this.buildId && !forceRefresh) {
            return this.buildId;
        }
        const $ = await this.fetchCheerio({ url: BASE_URL, method: 'GET' });
        const nextData = $('script#__NEXT_DATA__').first().text();
        if (!nextData) {
            throw new Error('Failed to find __NEXT_DATA__');
        }
        const parsed = JSON.parse(nextData);
        if (!parsed.buildId) {
            throw new Error('Failed to find buildId');
        }
        this.buildId = parsed.buildId;
        return this.buildId;
    }
    async getBrowseSeries() {
        const cached = this.browseCache;
        if (cached && Date.now() - cached.at < FlameComicsExtension.BROWSE_TTL_MS) {
            return cached.series;
        }
        const data = await this.fetchData('browse.json');
        const series = (data.pageProps?.series ?? []).filter((s) => s.series_id != null);
        this.browseCache = { at: Date.now(), series };
        return series;
    }
    async fetchData(path) {
        let buildId = await this.getBuildId();
        let [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/_next/data/${buildId}/${path}`,
            method: 'GET',
        });
        if (response.status === 404) {
            buildId = await this.getBuildId(true);
            [response, data] = await Application.scheduleRequest({
                url: `${BASE_URL}/_next/data/${buildId}/${path}`,
                method: 'GET',
            });
        }
        if (response.status === 404) {
            throw new Error('Content not found');
        }
        const str = Application.arrayBufferToUTF8String(data);
        return JSON.parse(str);
    }
    async fetchCheerio(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404) {
            throw new Error('Content not found');
        }
        const htmlStr = Application.arrayBufferToUTF8String(data);
        const dom = htmlparser2.parseDocument(htmlStr);
        return cheerio.load(dom);
    }
}
export const FlameComics = new FlameComicsExtension();
