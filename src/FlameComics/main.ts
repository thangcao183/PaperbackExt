import {
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
    MangaProviding,
    Metadata,
    PagedResults,
    PaperbackInterceptor,
    Request,
    Response,
    SearchQuery,
    SearchResultItem,
    SearchResultsProviding,
    SourceManga,
    TagSection,
} from '@paperback/types'
import * as cheerio from 'cheerio'
import * as htmlparser2 from 'htmlparser2'

const BASE_URL = 'https://flamecomics.xyz'
const CDN = 'https://cdn.flamecomics.xyz'
const ITEMS_PER_PAGE = 20
const SPECIAL_CHARS = /[^A-Za-z0-9 ]/g

interface FlameSeries {
    title: string
    altTitles?: string[] | null
    description?: string | null
    cover: string
    type: string
    tags?: string[] | null
    author?: string[] | null
    artist?: string[] | null
    status: string
    series_id?: number | null
    last_edit: number
    views?: number | null
}

interface FlameChapter {
    chapter: number | string
    title?: string | null
    release_date: number
    series_id: number
    token: string
}

interface FlameChapterPage {
    release_date: number
    series_id: number
    token: string
    images: Record<string, { name: string }>
}

interface SearchPageData {
    pageProps: { series: FlameSeries[] }
}

interface LatestPageData {
    pageProps: { latestEntries: { blocks: { series: FlameSeries[] }[] } }
}

interface MangaDetailsResponseData {
    pageProps: { series: FlameSeries }
}

interface ChapterListResponseData {
    pageProps: { chapters: FlameChapter[] }
}

interface ChapterPageData {
    pageProps: { chapter: FlameChapterPage }
}

class FlameComicsInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: Request): Promise<Request> {
        request.headers = {
            ...request.headers,
            referer: `${BASE_URL}/`,
            origin: BASE_URL,
            'user-agent': await Application.getDefaultUserAgent(),
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
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

type FlameComicsImplementation = Extension &
    SearchResultsProviding &
    MangaProviding &
    ChapterProviding &
    CloudflareBypassRequestProviding &
    DiscoverSectionProviding

export class FlameComicsExtension implements FlameComicsImplementation {
    requestManager = new FlameComicsInterceptor('main')
    cookieStorageInterceptor = new CookieStorageInterceptor({ storage: 'stateManager' })
    globalRateLimiter = new BasicRateLimiter('rateLimiter', {
        numberOfRequests: 2,
        bufferInterval: 2,
        ignoreImages: true,
    })

    private buildId = ''

    async initialise(): Promise<void> {
        this.requestManager.registerInterceptor()
        this.cookieStorageInterceptor.registerInterceptor()
        this.globalRateLimiter.registerInterceptor()
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: 'popular_section', title: 'Popular', type: DiscoverSectionType.featured },
            { id: 'latest_section', title: 'Latest Updates', type: DiscoverSectionType.simpleCarousel },
        ]
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata?: Metadata,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as { page?: number } | undefined)?.page ?? 1

        if (section.id === 'latest_section') {
            const data = await this.fetchData<LatestPageData>('index.json')
            const series = data.pageProps?.latestEntries?.blocks?.[0]?.series ?? []
            const items = series
                .filter((s) => s.series_id != null)
                .map((s) => this.seriesToDiscoverItem(s, 'simpleCarouselItem'))
            return { items, metadata: undefined }
        }

        const data = await this.fetchData<SearchPageData>('browse.json')
        const series = (data.pageProps?.series ?? [])
            .filter((s) => s.series_id != null)
            .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
        const start = (page - 1) * ITEMS_PER_PAGE
        const end = Math.min(page * ITEMS_PER_PAGE, series.length)
        const items = series.slice(start, end).map((s) => this.seriesToDiscoverItem(s, 'featuredCarouselItem'))
        return { items, metadata: end < series.length ? { page: page + 1 } : undefined }
    }

    async getSearchResults(
        query: SearchQuery<Metadata>,
        metadata: Metadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        const page = (metadata as { page?: number } | undefined)?.page ?? 1
        const titleQuery = query.title?.trim() ?? ''

        const data = await this.fetchData<SearchPageData>('browse.json')
        let series = (data.pageProps?.series ?? []).filter((s) => s.series_id != null)

        if (titleQuery) {
            const norm = titleQuery.toLowerCase().replace(SPECIAL_CHARS, '')
            series = series.filter((s) => {
                const titles = [s.title, ...(s.altTitles ?? [])]
                return titles.some((t) => t && t.toLowerCase().replace(SPECIAL_CHARS, '').includes(norm))
            })
        }

        const start = (page - 1) * ITEMS_PER_PAGE
        const end = Math.min(page * ITEMS_PER_PAGE, series.length)
        const items = series.slice(start, end).map((s) => this.seriesToSearchItem(s))
        return { items, metadata: end < series.length ? { page: page + 1 } : undefined }
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const seriesId = this.safeDecode(mangaId)
        const data = await this.fetchData<MangaDetailsResponseData>(
            `series/${seriesId}.json?id=${encodeURIComponent(seriesId)}`,
        )
        const s = data.pageProps.series
        const genres = s.tags ? [s.type, ...s.tags] : [s.type]
        const tags = genres
            .filter((g) => !!g)
            .map((g) => ({ id: this.tagId(g), title: g }))
        const tagGroups: TagSection[] = tags.length
            ? [{ id: 'genres', title: 'Genres', tags }]
            : []

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
        }
    }

    async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        const seriesId = this.safeDecode(sourceManga.mangaId)
        const data = await this.fetchData<ChapterListResponseData>(
            `series/${seriesId}.json?id=${encodeURIComponent(seriesId)}`,
        )
        return data.pageProps.chapters.map((ch) => {
            // The API returns `chapter` as a string like "214.00"; coerce to a
            // number so Paperback can decode chapNum as a Double, and format a
            // clean label ("214", "97.5").
            const chapNum = Number(ch.chapter)
            const safeNum = Number.isFinite(chapNum) ? chapNum : 0
            const chapStr = Number.isFinite(chapNum)
                ? String(chapNum)
                : String(ch.chapter)
            let title = `Chapter ${chapStr}`
            if (ch.title && ch.title.trim()) {
                title += ` - ${ch.title.trim()}`
            }
            return {
                chapterId: this.toSafeId(`${ch.series_id}/${ch.token}`),
                sourceManga,
                title,
                volume: 0,
                chapNum: safeNum,
                publishDate: new Date(ch.release_date * 1000),
                langCode: '🇬🇧',
            }
        })
    }

    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        const decoded = this.safeDecode(chapter.chapterId)
        const slashIndex = decoded.indexOf('/')
        const seriesId = decoded.substring(0, slashIndex)
        const token = decoded.substring(slashIndex + 1)
        const data = await this.fetchData<ChapterPageData>(
            `series/${seriesId}/${token}.json?id=${encodeURIComponent(seriesId)}&token=${encodeURIComponent(token)}`,
        )
        const ch = data.pageProps.chapter
        const images = Object.values(ch.images ?? {})
        const pages = images.map(
            (p) =>
                `${CDN}/uploads/images/series/${ch.series_id}/${ch.token}/${p.name}?${ch.release_date}`,
        )
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        }
    }

    async getMangaShareUrl(mangaId: string): Promise<string> {
        return `${BASE_URL}/series/${this.safeDecode(mangaId)}`
    }

    async cloudflareBypassCompleted(
        _request: globalThis.Request,
        cookies: Cookie[],
        _localStorage: Record<string, string>,
    ): Promise<void> {
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            this.cookieStorageInterceptor.deleteCookie(cookie)
        }
        const now = Date.now()
        for (const cookie of cookies) {
            if (!cookie.expires || cookie.expires.getTime() > now) {
                this.cookieStorageInterceptor.setCookie(cookie)
            }
        }
    }

    // --- Helpers ---

    private seriesToDiscoverItem(
        s: FlameSeries,
        type: 'featuredCarouselItem' | 'simpleCarouselItem',
    ): DiscoverSectionItem {
        return {
            type,
            mangaId: String(s.series_id),
            imageUrl: this.thumbnailUrl(s),
            title: s.title,
            metadata: undefined,
        }
    }

    private seriesToSearchItem(s: FlameSeries): SearchResultItem {
        return {
            mangaId: String(s.series_id),
            title: s.title,
            imageUrl: this.thumbnailUrl(s),
            subtitle: undefined,
            metadata: undefined,
        }
    }

    private thumbnailUrl(s: FlameSeries): string {
        return `${CDN}/uploads/images/series/${s.series_id}/${s.cover}?${s.last_edit}#thumbnail`
    }

    // Build a Paperback-safe tag id (allowed charset is alphanumeric plus
    // `._-@()[]%?#+=/&:`; spaces and other characters are not permitted).
    private tagId(genre: string): string {
        const slug = genre
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]/g, '')
        return slug || genre.toLowerCase().replace(/[^a-z0-9]/g, '') || 'tag'
    }

    private parseStatus(status: string): string {
        switch (status.toLowerCase()) {
            case 'ongoing':
                return 'Ongoing'
            case 'dropped':
                return 'Cancelled'
            case 'hiatus':
                return 'Hiatus'
            case 'completed':
                return 'Completed'
            default:
                return 'Unknown'
        }
    }

    private stripHtml(html?: string | null): string {
        if (!html) {
            return ''
        }
        const dom = htmlparser2.parseDocument(html)
        const $ = cheerio.load(dom)
        return $.root().text().trim()
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

    private async getBuildId(forceRefresh = false): Promise<string> {
        if (this.buildId && !forceRefresh) {
            return this.buildId
        }
        const $ = await this.fetchCheerio({ url: BASE_URL, method: 'GET' })
        const nextData = $('script#__NEXT_DATA__').first().text()
        if (!nextData) {
            throw new Error('Failed to find __NEXT_DATA__')
        }
        const parsed = JSON.parse(nextData) as { buildId?: string }
        if (!parsed.buildId) {
            throw new Error('Failed to find buildId')
        }
        this.buildId = parsed.buildId
        return this.buildId
    }

    private async fetchData<T>(path: string): Promise<T> {
        let buildId = await this.getBuildId()
        let [response, data] = await Application.scheduleRequest({
            url: `${BASE_URL}/_next/data/${buildId}/${path}`,
            method: 'GET',
        })

        if (response.status === 404) {
            buildId = await this.getBuildId(true)
            ;[response, data] = await Application.scheduleRequest({
                url: `${BASE_URL}/_next/data/${buildId}/${path}`,
                method: 'GET',
            })
        }

        if (response.status === 404) {
            throw new Error('Content not found')
        }

        const str = Application.arrayBufferToUTF8String(data)
        return JSON.parse(str) as T
    }

    private async fetchCheerio(request: Request) {
        const [response, data] = await Application.scheduleRequest(request)
        if (response.status === 404) {
            throw new Error('Content not found')
        }
        const htmlStr = Application.arrayBufferToUTF8String(data)
        const dom = htmlparser2.parseDocument(htmlStr)
        return cheerio.load(dom)
    }
}

export const FlameComics = new FlameComicsExtension()
