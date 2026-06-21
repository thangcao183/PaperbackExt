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
} from "@paperback/types";

const BASE_URL = "https://www.voyce.me";
const GRAPHQL_URL = "https://graphql.voyce.me/v1/graphql";
const STATIC_URL = "https://dlkfxmdtxtzpb.cloudfront.net/";
const PER_PAGE = 10;

// ----------------------------------------------------------------
// GraphQL queries (ported verbatim from upstream)
// ----------------------------------------------------------------

const POPULAR_QUERY = `query($limit: Int, $offset: Int) {
  voyce_series(
    where: { publish: { _eq: 1 }, type: { id: { _in: [2, 4] } } },
    order_by: [{ views_counts: { count: desc_nulls_last } }],
    limit: $limit,
    offset: $offset
  ) { id slug thumbnail title }
}`;

const LATEST_QUERY = `query($limit: Int, $offset: Int) {
  voyce_series(
    where: { publish: { _eq: 1 }, type: { id: { _in: [2, 4] } } },
    order_by: [{ updated_at: desc }],
    limit: $limit,
    offset: $offset
  ) { id slug thumbnail title }
}`;

const SEARCH_QUERY = `query($searchTerm: String!, $limit: Int, $offset: Int) {
  voyce_series(
    where: {
      publish: { _eq: 1 },
      type: { id: { _in: [2, 4] } },
      title: { _ilike: $searchTerm }
    },
    order_by: [{ views_counts: { count: desc_nulls_last } }],
    limit: $limit,
    offset: $offset
  ) { id slug thumbnail title }
}`;

const DETAILS_QUERY = `query($slug: String!) {
  voyce_series(
    where: {
      publish: { _eq: 1 },
      type: { id: { _in: [2, 4] } },
      slug: { _eq: $slug }
    },
    limit: 1
  ) {
    id slug thumbnail title description status
    author { username }
    genres(order_by: [{ genre: { title: asc } }]) { genre { title } }
  }
}`;

const CHAPTERS_QUERY = `query($slug: String!) {
  voyce_series(
    where: {
      publish: { _eq: 1 },
      type: { id: { _in: [2, 4] } },
      slug: { _eq: $slug }
    },
    limit: 1
  ) {
    slug
    chapters(order_by: [{ created_at: desc }]) { id title created_at }
  }
}`;

const PAGES_QUERY = `query($chapterId: Int!) {
  voyce_chapter_images(
    where: { chapter_id: { _eq: $chapterId } },
    order_by: { sort_order: asc }
  ) { image }
}`;

// ----------------------------------------------------------------
// JSON response shapes
// ----------------------------------------------------------------

interface VoyceSeries {
  id?: number;
  slug?: string;
  thumbnail?: string;
  title?: string;
  description?: string | null;
  status?: string | null;
  author?: { username?: string | null } | null;
  genres?: { genre?: { title?: string | null } | null }[];
  chapters?: { id?: number; title?: string; created_at?: string }[];
}

class VoyceMeInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "*/*",
      "accept-language": "en-US,en;q=0.5",
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
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

type VoyceMeImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class VoyceMeExtension implements VoyceMeImplementation {
  requestManager = new VoyceMeInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
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

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as { page?: number } | undefined;
    const page = meta?.page ?? 1;
    const offset = (page - 1) * PER_PAGE;

    const query = section.id === "latest" ? LATEST_QUERY : POPULAR_QUERY;
    const series = await this.graphQLSeries(query, {
      limit: PER_PAGE,
      offset,
    });

    const items: DiscoverSectionItem[] = [];
    for (const s of series) {
      const parsed = this.seriesToItem(s);
      if (!parsed) continue;
      items.push({
        type:
          section.id === "latest"
            ? "simpleCarouselItem"
            : "featuredCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    }

    return {
      items,
      metadata: series.length === PER_PAGE ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as { page?: number } | undefined;
    const page = meta?.page ?? 1;
    const offset = (page - 1) * PER_PAGE;
    const titleQuery = (query.title || "").trim();

    const series = await this.graphQLSeries(SEARCH_QUERY, {
      searchTerm: `%${titleQuery}%`,
      limit: PER_PAGE,
      offset,
    });

    const results: SearchResultItem[] = [];
    for (const s of series) {
      const parsed = this.seriesToItem(s);
      if (!parsed) continue;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    return {
      items: results,
      metadata: series.length === PER_PAGE ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const series = await this.graphQLSeries(DETAILS_QUERY, { slug });
    const comic = series[0];
    if (!comic) {
      throw new Error("Content not found");
    }

    const genreTitles = (comic.genres ?? [])
      .map((g) => (g.genre?.title ?? "").trim())
      .filter((t) => t.length > 0);

    const tagGroups: TagSection[] = [];
    if (genreTitles.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreTitles.map((t) => ({
          id: t.toLowerCase().replace(/\s+/g, "-"),
          title: t,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: comic.title || slug,
        secondaryTitles: [],
        thumbnailUrl: this.staticImage(comic.thumbnail),
        author: comic.author?.username || undefined,
        artist: comic.author?.username || undefined,
        synopsis: this.cleanText(comic.description ?? ""),
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(comic.status ?? ""),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const series = await this.graphQLSeries(CHAPTERS_QUERY, { slug });
    const comic = series[0];
    if (!comic) return [];

    const rawChapters = comic.chapters ?? [];
    const chapters: Chapter[] = [];
    const seenNames = new Set<string>();

    rawChapters.forEach((ch, index) => {
      if (ch.id === undefined || ch.id === null) return;
      const name = ch.title ?? "";
      if (seenNames.has(name)) return;
      seenNames.add(name);

      chapters.push({
        chapterId: this.toSafeId(`${slug}/${ch.id}`),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: rawChapters.length - index,
        publishDate: this.parseDate(ch.created_at),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = this.chapterNumericId(chapter.chapterId);
    const images = await this.graphQLImages(PAGES_QUERY, { chapterId });

    const pages = images
      .map((img) => this.staticImage(img.image))
      .filter((p) => p.length > 0);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // GraphQL helpers
  // ----------------------------------------------------------------

  private async graphQLSeries(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<VoyceSeries[]> {
    const json = await this.graphQLPost(query, variables);
    const data = (json as { data?: { voyce_series?: VoyceSeries[] } }).data;
    return data?.voyce_series ?? [];
  }

  private async graphQLImages(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{ image: string }[]> {
    const json = await this.graphQLPost(query, variables);
    const data = (json as { data?: { voyce_chapter_images?: { image: string }[] } })
      .data;
    return data?.voyce_chapter_images ?? [];
  }

  private async graphQLPost(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const request: Request = {
      url: GRAPHQL_URL,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    };
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const str = Application.arrayBufferToUTF8String(data);
    return JSON.parse(str);
  }

  // ----------------------------------------------------------------
  // Mapping + parsing helpers
  // ----------------------------------------------------------------

  private seriesToItem(
    s: VoyceSeries,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const slug = (s.slug ?? "").trim();
    const title = (s.title ?? "").trim();
    if (!slug || !title) return undefined;
    return {
      mangaId: this.toSafeId(slug),
      imageUrl: this.staticImage(s.thumbnail),
      title,
    };
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/series/${slug.replace(/^\/+/, "")}`;
  }

  private chapterNumericId(chapterId: string): number {
    const decoded = this.safeDecode(chapterId);
    const last = decoded.split("/").pop() ?? "";
    const id = parseInt(last.replace(/#.*$/, ""), 10);
    return Number.isNaN(id) ? 0 : id;
  }

  private staticImage(path: string | undefined | null): string {
    const p = (path ?? "").trim();
    if (!p) return "";
    if (p.startsWith("http")) return p;
    if (p.startsWith("//")) return `https:${p}`;
    return `${STATIC_URL}${p.replace(/^\/+/, "")}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("completed")) return "Completed";
    if (s.includes("ongoing")) return "Ongoing";
    return "Unknown";
  }

  private parseDate(value: string | undefined): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value);
    return Number.isNaN(t) ? new Date(0) : new Date(t);
  }

  private cleanText(raw: string): string {
    return raw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  // ----------------------------------------------------------------
  // Cloudflare
  // ----------------------------------------------------------------

  async cloudflareBypassCompleted(
    _request: globalThis.Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      this.cookieStorageInterceptor.deleteCookie(cookie);
    }
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }
}

export const VoyceMe = new VoyceMeExtension();
