import {
    AdvancedSearchForm,
    BasicRateLimiter,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CloudflareBypassRequestProviding,
    CloudflareError,
    ContentRating,
    Cookie,
    CookieStorageInterceptor,
    DiscoverSection,
    DiscoverSectionItem,
    DiscoverSectionProviding,
    DiscoverSectionType,
    Extension,
    Form,
    MangaProviding,
    Metadata,
    PagedResults,
    PaperbackInterceptor,
    Request,
    Response,
    SearchQuery,
    SearchResultItem,
    SearchResultsProviding,
    SettingsFormProviding,
    SourceManga,
    TagSection,
} from '@paperback/types'
import { getShowAdult, MangaDotNetSettingsForm } from './settings'
import { MangaDotNetSearchForm, MangaDotNetSearchMeta } from './forms'

const BASE_URL = 'https://mangadot.net'

class MangaDotNetInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: Request): Promise<Request> {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            'user-agent': await Application.getDefaultUserAgent(),
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.5',
        }
        return request
    }

    override async interceptResponse(
        request: Request,
        response: Response,
        data: ArrayBuffer,
    ): Promise<ArrayBuffer> {
        if (response.headers?.['cf-mitigated'] === 'challenge') {
            throw new CloudflareError({
                url: request.url,
                method: request.method ?? 'GET',
                headers: { 'user-agent': await Application.getDefaultUserAgent() },
            })
        }
        return data
    }
}

interface BrowseManga {
    id: number
    title: string
    photo?: string
}

interface Pagination {
    total_pages?: number
    current_page?: number
    next_cursor?: string
}

interface MangaList {
    results?: BrowseManga[]
    manga_list?: BrowseManga[]
    pagination?: Pagination
    allGenres?: string[]
}

interface MangaDetail {
    id: number
    title: string
    genres?: string[]
    description?: string
    photo?: string
    hiatus?: string
    status?: string
    alt_titles?: string[]
    country_of_origin?: string
    authors?: string
    artists?: string
}

interface ApiChapter {
    id: number
    chapter_number?: number
    volume_number?: number
    chapter_title?: string
    group_name?: string
    scanlator_name?: string
    date_added?: string
    source?: string
}

interface ApiImages {
    manga: { id: number }
    images: { url: string }[]
}

type MangaDotNetImplementation = Extension &
    SearchResultsProviding &
    MangaProviding &
    ChapterProviding &
    CloudflareBypassRequestProviding &
    SettingsFormProviding &
    DiscoverSectionProviding

export class MangaDotNetExtension implements MangaDotNetImplementation {
    requestManager = new MangaDotNetInterceptor('main')
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: 'stateManager' })
    globalRateLimiter = new BasicRateLimiter('rateLimiter', {
        numberOfRequests: 2,
        bufferInterval: 1,
        ignoreImages: true,
    })

    async initialise(): Promise<void> {
        this.requestManager.registerInterceptor()
        this.cookieStorageInterceptor.registerInterceptor()
        this.globalRateLimiter.registerInterceptor()
    }

    async getSettingsForm(): Promise<Form> {
        return new MangaDotNetSettingsForm()
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
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
        ]
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: Metadata | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as { page?: number })?.page ?? 1
        const mode = section.id === 'popular' ? 'most-tracked' : 'latest-updates'
        const url = this.buildBrowseUrl(mode, page)
        const list = this.parseRouteData<MangaList>(
            await this.fetchString({ url, method: 'GET' }),
            'pages/ViewAllPage',
            true,
        )
        const entries = list.results ?? list.manga_list ?? []
        const itemType =
            section.id === 'popular' ? 'featuredCarouselItem' : 'simpleCarouselItem'
        const items: DiscoverSectionItem[] = []
        for (const m of entries) {
            const imageUrl = this.thumbUrl(m.photo)
            if (!imageUrl) continue
            items.push({
                type: itemType,
                mangaId: this.toSafeId(String(m.id)),
                imageUrl,
                title: m.title,
                metadata: undefined,
            })
        }
        return {
            items,
            metadata: this.hasNext(list.pagination) ? { page: page + 1 } : undefined,
        }
    }

    private buildBrowseUrl(mode: string, page: number): string {
        const params: string[] = []
        if (getShowAdult()) {
            params.push('adult=both')
        } else {
            params.push('adult=0')
        }
        if (page > 1) params.push(`page=${page}`)
        params.push('_routes=pages/ViewAllPage')
        return `${BASE_URL}/view-all/${mode}.data?${params.join('&')}`
    }

    async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<AdvancedSearchForm> {
        const meta = (query.metadata as { searchMeta?: MangaDotNetSearchMeta })?.searchMeta
        return new MangaDotNetSearchForm(meta)
    }

    async getSearchResults(
        query: SearchQuery<Metadata>,
        metadata: Metadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        const titleQuery = query.title.trim()
        const searchMeta = (query.metadata as { searchMeta?: MangaDotNetSearchMeta })?.searchMeta
        const page = (metadata as { page?: number })?.page ?? 1

        const params: string[] = []
        params.push(getShowAdult() ? 'adult=both' : 'adult=0')
        if (titleQuery) params.push(`search=${encodeURIComponent(titleQuery)}`)
        params.push(`page=${page}`)

        const sort = searchMeta?.sort?.[0] ?? ''
        const effectiveSort = sort === '' && !titleQuery ? 'latest' : sort
        if (effectiveSort) params.push(`sortBy=${effectiveSort}`)
        const order = searchMeta?.order?.[0]
        if (order) params.push(`sortOrder=${order}`)

        const status = searchMeta?.status?.[0]
        if (status) params.push(`status=${encodeURIComponent(status)}`)

        for (const t of searchMeta?.types ?? []) {
            params.push(`origin=${encodeURIComponent(t)}`)
        }
        for (const d of searchMeta?.demographics ?? []) {
            params.push(`genre=${encodeURIComponent(d)}`)
        }
        params.push('_routes=pages/SearchPage')

        const url = `${BASE_URL}/search.data?${params.join('&')}`
        const list = this.parseRouteData<MangaList>(
            await this.fetchString({ url, method: 'GET' }),
            'pages/SearchPage',
            false,
        )
        const entries = list.results ?? list.manga_list ?? []
        const items: SearchResultItem[] = []
        for (const m of entries) {
            const imageUrl = this.thumbUrl(m.photo)
            if (!imageUrl) continue
            items.push({
                mangaId: this.toSafeId(String(m.id)),
                title: m.title,
                imageUrl,
                metadata: undefined,
            })
        }
        return {
            items,
            metadata: this.hasNext(list.pagination) ? { page: page + 1 } : undefined,
        }
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const id = this.safeDecode(mangaId)
        const url = `${BASE_URL}/manga/${id}.data?_routes=pages/MangaDetailPage`
        const root = this.parseRoute(
            await this.fetchString({ url, method: 'GET' }),
            'pages/MangaDetailPage',
        ) as { data?: { mangaData?: { manga?: MangaDetail } } }
        const manga = root.data?.mangaData?.manga
        if (!manga) throw new Error('Manga not found')

        const genres: string[] = []
        switch (manga.country_of_origin) {
            case 'JP':
                genres.push('Manga')
                break
            case 'KR':
                genres.push('Manhwa')
                break
            case 'CN':
                genres.push('Manhua')
                break
        }
        for (const g of manga.genres ?? []) genres.push(g.trim())

        const tagGroups: TagSection[] =
            genres.length > 0
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
                : []

        const status = this.parseStatus(manga)

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
        }
    }

    async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        const id = this.safeDecode(sourceManga.mangaId)
        const url = `${BASE_URL}/api/manga/${id}/chapters/list?lang=en`
        const apiChapters = await this.fetchJson<ApiChapter[]>({ url, method: 'GET' })

        const chapters: Chapter[] = apiChapters.map((ch) => {
            const numberStr = ch.chapter_number != null ? String(ch.chapter_number).replace(/\.0$/, '') : '0'
            const name = ch.chapter_title ?? ''
            let title: string
            if (!name.includes(numberStr)) {
                title = `Chapter ${numberStr}` + (name ? `: ${name.trim()}` : '')
            } else {
                title = name.trim()
            }
            const source = ch.source ?? 'user'
            return {
                chapterId: this.toSafeId(`${ch.id}|${source}`),
                sourceManga,
                title,
                volume: 0,
                chapNum: ch.chapter_number ?? 0,
                publishDate: this.parseDate(ch.date_added),
                langCode: '🇬🇧',
            }
        })

        return chapters.reverse()
    }

    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        const decoded = this.safeDecode(chapter.chapterId)
        const parts = decoded.split('|')
        const chapterId = parts[0]
        const source = parts[1] ?? 'user'
        const segment = source === 'user' ? 'uploads' : 'chapters'
        const url = `${BASE_URL}/api/${segment}/${chapterId}/images`
        const data = await this.fetchJson<ApiImages>({ url, method: 'GET' })

        const pages: string[] = []
        for (const img of data.images) {
            if (img.url.startsWith('/')) {
                pages.push(BASE_URL + img.url)
            } else if (img.url.startsWith('http')) {
                pages.push(img.url)
            }
        }

        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        }
    }

    async getMangaShareUrl(mangaId: string): Promise<string> {
        return `${BASE_URL}/manga/${this.safeDecode(mangaId)}`
    }

    async cloudflareBypassCompleted(
        _request: globalThis.Request,
        cookies: Cookie[],
        _localStorage: Record<string, string>,
    ): Promise<void> {
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            this.cookieStorageInterceptor.deleteCookie(cookie)
        }
        for (const cookie of cookies) {
            if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue
            this.cookieStorageInterceptor.setCookie(cookie)
        }
    }

    // ===================== RSC flat-array decoder =====================
    private parseRouteData<T>(text: string, route: string, viewAll: boolean): T {
        const root = this.parseRoute(text, route) as Record<string, unknown>
        if (viewAll) {
            // ViewAllData { data: MangaList, allGenres }
            return (root.data ?? root) as T
        }
        return root as T
    }

    private parseRoute(text: string, route: string): unknown {
        const flat = JSON.parse(text) as unknown[]
        const decoded = this.decodeRsc(flat)
        if (decoded == null) throw new Error('Failed to decode RSC response')
        const obj = decoded as Record<string, unknown>
        if (route in obj) return obj[route]
        return decoded
    }

    private decodeRsc(flat: unknown[]): unknown {
        const cache = new Array<unknown>(flat.length)
        const nil = Symbol('nil')
        const resolve = (i: number): unknown => {
            if (i < 0) return null
            if (cache[i] !== undefined) {
                return cache[i] === nil ? null : cache[i]
            }
            const el = flat[i]
            let result: unknown
            if (el === null) {
                result = null
            } else if (Array.isArray(el)) {
                result = el.map((ref) => resolve(ref as number))
            } else if (typeof el === 'object') {
                const out: Record<string, unknown> = {}
                for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
                    const keyIndex = parseInt(k.replace(/^_/, ''), 10)
                    const realKey = String(flat[keyIndex])
                    out[realKey] = resolve(v as number)
                }
                result = out
            } else {
                result = el
            }
            cache[i] = result == null ? nil : result
            return result
        }
        return resolve(0)
    }

    // ============================ Helpers =============================
    private hasNext(pagination?: Pagination): boolean {
        if (!pagination) return false
        if (pagination.current_page != null && pagination.total_pages != null) {
            return pagination.current_page < pagination.total_pages
        }
        if (pagination.next_cursor != null) return true
        return false
    }

    private thumbUrl(photo?: string): string {
        if (!photo) return ''
        if (photo.startsWith('/')) return BASE_URL + photo
        if (photo.startsWith('http')) return photo
        return ''
    }

    private parseList(value?: string): string | undefined {
        if (!value) return undefined
        try {
            const arr = JSON.parse(value)
            if (Array.isArray(arr)) return arr.join(', ')
        } catch {
            // not JSON, return as-is
        }
        return value
    }

    private stripDescription(description?: string): string {
        if (!description) return ''
        return description
            .replace(/\r\n/g, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
    }

    private parseStatus(manga: MangaDetail): string {
        if ((manga.genres ?? []).includes('One Shot')) return 'Completed'
        if (manga.hiatus === 'Yes') return 'Hiatus'
        switch (manga.status?.toLowerCase()) {
            case 'ongoing':
                return 'Ongoing'
            case 'completed':
                return 'Completed'
            default:
                return 'Unknown'
        }
    }

    private parseDate(dateStr?: string): Date {
        if (!dateStr) return new Date(0)
        const cleaned = dateStr.split('+')[0].trim().replace(' ', 'T') + 'Z'
        const parsed = new Date(cleaned)
        if (!isNaN(parsed.getTime())) return parsed
        return new Date(0)
    }

    private toSafeId(slug: string): string {
        return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
            const enc = encodeURIComponent(c)
            return enc !== c ? enc : '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
        })
    }

    private safeDecode(id: string): string {
        try {
            return decodeURIComponent(id)
        } catch {
            return id
        }
    }

    private async fetchString(request: Request): Promise<string> {
        const [response, data] = await Application.scheduleRequest(request)
        if (response.status === 404) throw new Error('Content not found')
        return Application.arrayBufferToUTF8String(data)
    }

    private async fetchJson<T>(request: Request): Promise<T> {
        const [response, data] = await Application.scheduleRequest(request)
        if (response.status === 404) throw new Error('Content not found')
        return JSON.parse(Application.arrayBufferToUTF8String(data)) as T
    }
}

export const MangaDotNet = new MangaDotNetExtension()
