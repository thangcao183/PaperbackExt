import { BasicRateLimiter, CloudflareError, ContentRating, CookieStorageInterceptor, DiscoverSectionType, PaperbackInterceptor, } from '@paperback/types';
import { getShowAdult, getShowTags, MangaDotNetSettingsForm } from './settings';
import { MangaDotNetSearchForm } from './forms';
const BASE_URL = 'https://mangadot.net';
class MangaDotNetInterceptor extends PaperbackInterceptor {
    async interceptRequest(request) {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            'user-agent': await Application.getDefaultUserAgent(),
            accept: 'application/json, text/plain, */*',
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
export class MangaDotNetExtension {
    requestManager = new MangaDotNetInterceptor('main');
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: 'stateManager' });
    globalRateLimiter = new BasicRateLimiter('rateLimiter', {
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
        return new MangaDotNetSettingsForm();
    }
    async getDiscoverSections() {
        return [
            {
                id: 'popular',
                title: 'Popular',
                type: DiscoverSectionType.featured,
            },
            {
                id: 'latest',
                title: 'Latest Updates',
                type: DiscoverSectionType.simpleCarousel,
            },
        ];
    }
    async getDiscoverSectionItems(section, metadata) {
        const page = metadata?.page ?? 1;
        const mode = section.id === 'popular' ? 'most-tracked' : 'latest-updates';
        const url = this.buildBrowseUrl(mode, page);
        const list = this.parseRouteData(await this.fetchString({ url, method: 'GET' }), 'pages/ViewAllPage', true);
        const entries = list.results ?? list.manga_list ?? [];
        const itemType = section.id === 'popular' ? 'featuredCarouselItem' : 'simpleCarouselItem';
        const items = [];
        for (const m of entries) {
            const imageUrl = this.thumbUrl(m.photo);
            if (!imageUrl)
                continue;
            items.push({
                type: itemType,
                mangaId: this.toSafeId(String(m.id)),
                imageUrl,
                title: m.title,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: this.hasNext(list.pagination) ? { page: page + 1 } : undefined,
        };
    }
    buildBrowseUrl(mode, page) {
        const params = [];
        if (getShowAdult()) {
            params.push('adult=both');
        }
        else {
            params.push('adult=0');
        }
        if (page > 1)
            params.push(`page=${page}`);
        params.push('_routes=pages/ViewAllPage');
        return `${BASE_URL}/view-all/${mode}.data?${params.join('&')}`;
    }
    async getAdvancedSearchForm(query) {
        const meta = query.metadata?.searchMeta;
        return new MangaDotNetSearchForm(meta);
    }
    async getSearchResults(query, metadata) {
        const titleQuery = query.title.trim();
        const searchMeta = query.metadata?.searchMeta;
        const page = metadata?.page ?? 1;
        const params = [];
        params.push(getShowAdult() ? 'adult=both' : 'adult=0');
        if (titleQuery)
            params.push(`search=${encodeURIComponent(titleQuery)}`);
        params.push(`page=${page}`);
        params.push('perPage=56');
        const sort = searchMeta?.sort?.[0] ?? '';
        const effectiveSort = sort === '' && !titleQuery ? 'latest' : sort;
        if (effectiveSort)
            params.push(`sortBy=${effectiveSort}`);
        const order = searchMeta?.order?.[0];
        if (order)
            params.push(`sortOrder=${order}`);
        const status = searchMeta?.status?.[0];
        if (status)
            params.push(`status=${encodeURIComponent(status)}`);
        // Upstream #18163: scanlator-group filter.
        const scanlator = searchMeta?.scanlator?.[0];
        if (scanlator)
            params.push(`scanlator=${encodeURIComponent(scanlator)}`);
        for (const t of searchMeta?.types ?? []) {
            params.push(`origin=${encodeURIComponent(t)}`);
        }
        for (const d of searchMeta?.demographics ?? []) {
            params.push(`genre=${encodeURIComponent(d)}`);
        }
        params.push('_routes=pages/SearchPage');
        const url = `${BASE_URL}/search.data?${params.join('&')}`;
        const list = this.parseRouteData(await this.fetchString({ url, method: 'GET' }), 'pages/SearchPage', false);
        const entries = list.results ?? list.manga_list ?? [];
        const items = [];
        for (const m of entries) {
            const imageUrl = this.thumbUrl(m.photo);
            if (!imageUrl)
                continue;
            items.push({
                mangaId: this.toSafeId(String(m.id)),
                title: m.title,
                imageUrl,
                metadata: undefined,
            });
        }
        return {
            items,
            metadata: this.hasNext(list.pagination) ? { page: page + 1 } : undefined,
        };
    }
    async getMangaDetails(mangaId) {
        const id = this.safeDecode(mangaId);
        const url = `${BASE_URL}/manga/${id}.data?_routes=pages/MangaDetailPage`;
        const root = this.parseRoute(await this.fetchString({ url, method: 'GET' }), 'pages/MangaDetailPage');
        const manga = root.data?.mangaData?.manga;
        if (!manga)
            throw new Error('Manga not found');
        const genres = [];
        switch (manga.country_of_origin) {
            case 'JP':
                genres.push('Manga');
                break;
            case 'KR':
                genres.push('Manhwa');
                break;
            case 'CN':
                genres.push('Manhua');
                break;
        }
        for (const g of manga.genres ?? [])
            genres.push(g.trim());
        // Tags are exposed after genres in the same tag section (keiyoushi
        // #17066). Gated by a user toggle since some readers want to avoid
        // tag-borne spoilers.
        if (getShowTags()) {
            const tagNames = (manga.tags ?? [])
                .flatMap((c) => c.tags ?? [])
                .map((t) => t.name.trim())
                .filter((n) => n.length > 0)
                .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
            for (const t of tagNames)
                genres.push(t);
        }
        const tagGroups = genres.length > 0
            ? [
                {
                    id: 'genres',
                    title: 'Genres',
                    tags: genres.map((g) => ({
                        id: g.toLowerCase().replace(/\s+/g, '-'),
                        title: g,
                    })),
                },
            ]
            : [];
        const status = this.parseStatus(manga);
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: manga.title,
                secondaryTitles: manga.alt_titles ?? [],
                thumbnailUrl: this.thumbUrl(manga.photo),
                author: this.parseList(manga.authors),
                artist: this.parseList(manga.artists),
                synopsis: this.stripDescription(manga.description),
                contentRating: ContentRating.MATURE,
                status,
                tagGroups,
                shareUrl: `${BASE_URL}/manga/${id}`,
            },
        };
    }
    async getChapters(sourceManga) {
        const id = this.safeDecode(sourceManga.mangaId);
        const url = `${BASE_URL}/api/manga/${id}/chapters/list?lang=en`;
        const apiChapters = await this.fetchJson({ url, method: 'GET' });
        const chapters = apiChapters.map((ch) => {
            const numberStr = ch.chapter_number != null ? String(ch.chapter_number).replace(/\.0$/, '') : '0';
            const name = ch.chapter_title ?? '';
            let title;
            if (!name.includes(numberStr)) {
                title = `Chapter ${numberStr}` + (name ? `: ${name.trim()}` : '');
            }
            else {
                title = name.trim();
            }
            const source = ch.source ?? 'user';
            return {
                chapterId: this.toSafeId(`${ch.id}|${source}`),
                sourceManga,
                title,
                volume: 0,
                chapNum: ch.chapter_number ?? 0,
                publishDate: this.parseDate(ch.date_added),
                langCode: '🇬🇧',
            };
        });
        return chapters.reverse();
    }
    async getChapterDetails(chapter) {
        const decoded = this.safeDecode(chapter.chapterId);
        const parts = decoded.split('|');
        const chapterId = parts[0];
        const source = parts[1] ?? 'user';
        const segment = source === 'user' ? 'uploads' : 'chapters';
        const url = `${BASE_URL}/api/${segment}/${chapterId}/images`;
        const data = await this.fetchJson({ url, method: 'GET' });
        const pages = [];
        for (const img of data.images) {
            if (img.url.startsWith('/')) {
                pages.push(BASE_URL + img.url);
            }
            else if (img.url.startsWith('http')) {
                pages.push(img.url);
            }
        }
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    async getMangaShareUrl(mangaId) {
        return `${BASE_URL}/manga/${this.safeDecode(mangaId)}`;
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
    // ===================== RSC flat-array decoder =====================
    parseRouteData(text, route, _viewAll) {
        const root = this.parseRoute(text, route);
        // The route payload wraps the MangaList in one or more `data` levels
        // (ViewAllPage nests it two deep: { data: { data: { manga_list } } },
        // SearchPage one deep). Drill through `data` wrappers until we reach
        // the object that actually carries the list, so callers always get a
        // MangaList regardless of how many wrappers the route added.
        let cur = root;
        for (let depth = 0; depth < 6; depth++) {
            if (cur == null || typeof cur !== 'object')
                break;
            const obj = cur;
            if ('manga_list' in obj || 'results' in obj)
                return obj;
            if ('data' in obj) {
                cur = obj.data;
                continue;
            }
            break;
        }
        return (cur ?? root);
    }
    parseRoute(text, route) {
        const flat = JSON.parse(text);
        const decoded = this.decodeRsc(flat);
        if (decoded == null)
            throw new Error('Failed to decode RSC response');
        const obj = decoded;
        if (route in obj)
            return obj[route];
        return decoded;
    }
    decodeRsc(flat) {
        const cache = new Array(flat.length);
        const nil = Symbol('nil');
        const resolve = (i) => {
            if (i < 0)
                return null;
            if (cache[i] !== undefined) {
                return cache[i] === nil ? null : cache[i];
            }
            const el = flat[i];
            let result;
            if (el === null) {
                result = null;
            }
            else if (Array.isArray(el)) {
                result = el.map((ref) => resolve(ref));
            }
            else if (typeof el === 'object') {
                const out = {};
                for (const [k, v] of Object.entries(el)) {
                    const keyIndex = parseInt(k.replace(/^_/, ''), 10);
                    const realKey = String(flat[keyIndex]);
                    out[realKey] = resolve(v);
                }
                result = out;
            }
            else {
                result = el;
            }
            cache[i] = result == null ? nil : result;
            return result;
        };
        return resolve(0);
    }
    // ============================ Helpers =============================
    hasNext(pagination) {
        if (!pagination)
            return false;
        if (pagination.current_page != null && pagination.total_pages != null) {
            return pagination.current_page < pagination.total_pages;
        }
        if (pagination.next_cursor != null)
            return true;
        return false;
    }
    thumbUrl(photo) {
        if (!photo)
            return '';
        if (photo.startsWith('/'))
            return BASE_URL + photo;
        if (photo.startsWith('http'))
            return photo;
        return '';
    }
    parseList(value) {
        if (!value)
            return undefined;
        try {
            const arr = JSON.parse(value);
            if (Array.isArray(arr))
                return arr.join(', ');
        }
        catch {
            // not JSON, return as-is
        }
        return value;
    }
    stripDescription(description) {
        if (!description)
            return '';
        return description
            .replace(/\r\n/g, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    parseStatus(manga) {
        if ((manga.genres ?? []).includes('One Shot'))
            return 'Completed';
        if (manga.hiatus === 'Yes')
            return 'Hiatus';
        switch (manga.status?.toLowerCase()) {
            case 'ongoing':
                return 'Ongoing';
            case 'completed':
                return 'Completed';
            default:
                return 'Unknown';
        }
    }
    parseDate(dateStr) {
        if (!dateStr)
            return new Date(0);
        const cleaned = dateStr.split('+')[0].trim().replace(' ', 'T') + 'Z';
        const parsed = new Date(cleaned);
        if (!isNaN(parsed.getTime()))
            return parsed;
        return new Date(0);
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
    async fetchString(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404)
            throw new Error('Content not found');
        return Application.arrayBufferToUTF8String(data);
    }
    async fetchJson(request) {
        const [response, data] = await Application.scheduleRequest(request);
        if (response.status === 404)
            throw new Error('Content not found');
        return JSON.parse(Application.arrayBufferToUTF8String(data));
    }
}
export const MangaDotNet = new MangaDotNetExtension();
