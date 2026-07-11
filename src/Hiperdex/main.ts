import {
  BasicRateLimiter,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  ContentRating,
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

const BASE_URL = "https://hiperdex.com";
const MANGA_PATH = "manga";
const SEARCH_LIMIT = 30;

// ---- tRPC DTOs ----

interface MangaDto {
  id: number;
  slug: string;
  title: string;
  synopsis?: string | null;
  coverUrl?: string | null;
  status?: string | null;
  genres?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
}

interface WrapperContent {
  hits: MangaDto[];
}

interface ChapterDto {
  number: number;
  title?: string | null;
  createdAt: string;
}

interface PageDto {
  pageOrder: number;
  webpUrl: string;
  avifUrl?: string | null;
}

const NUMBER_REGEX = /\d+/;

class HiperdexInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      "user-agent": await Application.getDefaultUserAgent(),
    };
    return request;
  }

  override async interceptResponse(
    _request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    return data;
  }
}

type HiperdexImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  DiscoverSectionProviding;

class HiperdexExtension implements HiperdexImplementation {
  requestManager = new HiperdexInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

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
    const page = (metadata as { page?: number })?.page ?? 1;
    const sort = section.id === "popular" ? "popular" : "newest";
    const hits = await this.searchQuery("", page, sort);

    const items: DiscoverSectionItem[] = [];
    for (const manga of hits) {
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: this.mangaIdFromDto(manga),
        imageUrl: manga.coverUrl ?? "",
        title: manga.title,
        metadata: undefined,
      });
    }

    return {
      items,
      metadata: hits.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number })?.page ?? 1;
    const hits = await this.searchQuery(query.title.trim(), page);

    const items: SearchResultItem[] = [];
    for (const manga of hits) {
      items.push({
        mangaId: this.mangaIdFromDto(manga),
        title: manga.title,
        imageUrl: manga.coverUrl ?? "",
        metadata: undefined,
      });
    }

    return {
      items,
      metadata: hits.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { slug } = this.parseMangaId(mangaId);
    const input = {
      "0": {
        json: null,
        meta: { values: ["undefined"] },
      },
      "1": {
        json: { slug },
      },
    };
    const element = await this.fetchTrpc(
      "auth.me,series.bySlugWithGenres",
      input,
    );
    const series = this.dataJson<MangaDto>(element);
    if (!series) throw new Error("Series not found");

    const genres = (series.genres ?? []).filter(Boolean);
    const authors = (series.authors ?? []).filter(Boolean);
    const artists = (series.artists ?? []).filter(Boolean);

    const tagGroups: TagSection[] =
      genres.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genres.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: series.title,
        secondaryTitles: [],
        thumbnailUrl: series.coverUrl ?? "",
        author: authors.length > 0 ? authors.join(", ") : undefined,
        artist: artists.length > 0 ? artists.join(", ") : undefined,
        synopsis: series.synopsis ?? "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(series.status),
        tagGroups,
        shareUrl: `${BASE_URL}/${MANGA_PATH}/${slug}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { slug, id } = this.parseMangaId(sourceManga.mangaId);
    const input = {
      "0": {
        json: { values: ["undefined"] },
      },
      "1": {
        json: {
          seriesId: id,
          chapterId: null,
          sort: "best",
          page: 1,
          limit: 20,
        },
        meta: { values: { chapterId: ["undefined"] } },
      },
      "2": {
        json: { seriesId: id },
      },
    };
    const element = await this.fetchTrpc(
      "auth.me,comments.list,series.chapters",
      input,
    );
    const chaptersDto = this.dataJson<ChapterDto[]>(element) ?? [];

    const result: Chapter[] = [];
    for (const chap of chaptersDto) {
      result.push({
        chapterId: `${slug}#${chap.number}`,
        sourceManga,
        title: this.buildChapterName(chap),
        volume: 0,
        chapNum: chap.number,
        publishDate: this.parseDate(chap.createdAt),
        langCode: "🇬🇧",
      });
    }
    return result;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const hashIndex = decoded.lastIndexOf("#");
    const slug = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded;
    const numberStr = hashIndex >= 0 ? decoded.slice(hashIndex + 1) : "";
    const chapterNumber = Number(numberStr);

    const input = {
      "0": {
        json: null,
        meta: { values: ["undefined"] },
      },
      "1": {
        json: { slug },
      },
      "2": {
        json: {
          seriesSlug: slug,
          chapterNumber: isNaN(chapterNumber) ? 0 : chapterNumber,
        },
      },
    };
    const element = await this.fetchTrpc(
      "auth.me,series.bySlug,reader.chapterPages",
      input,
    );
    const pageDtos = this.dataJson<PageDto[]>(element) ?? [];

    const sorted = [...pageDtos].sort((a, b) => a.pageOrder - b.pageOrder);
    const pages: string[] = [];
    for (const page of sorted) {
      const url = page.avifUrl ?? page.webpUrl;
      if (url) pages.push(url);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const { slug } = this.parseMangaId(mangaId);
    return `${BASE_URL}/${MANGA_PATH}/${slug}`;
  }

  // ---- helpers ----

  private async searchQuery(
    query: string,
    page: number,
    sort?: string,
  ): Promise<MangaDto[]> {
    const json: Record<string, unknown> = {
      q: query,
    };
    if (sort) json.sort = sort;
    json.filters = {
      genres: null,
      type: null,
      status: null,
      contentRating: null,
      author: null,
      artist: null,
      year: null,
    };
    json.limit = SEARCH_LIMIT;
    json.offset = (page - 1) * SEARCH_LIMIT;
    json.maxRating = "pornographic";

    const input = {
      "0": {
        json,
        meta: {
          values: {
            "filters.genres": ["undefined"],
            "filters.type": ["undefined"],
            "filters.status": ["undefined"],
            "filters.contentRating": ["undefined"],
            "filters.author": ["undefined"],
            "filters.artist": ["undefined"],
            "filters.year": ["undefined"],
          },
        },
      },
    };

    const element = await this.fetchTrpc("search.query", input, 0);
    const wrapper = this.dataJson<WrapperContent>(element);
    return wrapper?.hits ?? [];
  }

  private buildChapterName(chap: ChapterDto): string {
    const numberStr = String(chap.number).replace(/\.0$/, "");
    const labelNumber = `Chapter ${numberStr}`;
    const title = chap.title;
    if (!title) return labelNumber;
    return NUMBER_REGEX.test(title) ? title : `${labelNumber} ${title}`;
  }

  private mangaIdFromDto(manga: MangaDto): string {
    return this.toSafeId(`${manga.slug}#${manga.id}`);
  }

  private parseMangaId(mangaId: string): { slug: string; id: string } {
    const decoded = this.safeDecode(mangaId);
    const hashIndex = decoded.lastIndexOf("#");
    if (hashIndex < 0) return { slug: decoded, id: "" };
    return {
      slug: decoded.slice(0, hashIndex),
      id: decoded.slice(hashIndex + 1),
    };
  }

  private parseStatus(status?: string | null): string {
    switch ((status ?? "").toLowerCase()) {
      case "ongoing":
        return "Ongoing";
      case "hiatus":
        return "Hiatus";
      case "cancelled":
        return "Cancelled";
      case "completed":
        return "Completed";
      default:
        return "Unknown";
    }
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    let str = value;
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) str += "Z";
    const date = new Date(str);
    return isNaN(date.getTime()) ? new Date(0) : date;
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      return enc !== c
        ? enc
        : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  // Navigate result.data.json of a single tRPC batch element.
  private dataJson<T>(element: unknown): T | undefined {
    const result = (element as { result?: { data?: { json?: unknown } } })
      ?.result?.data?.json;
    return (result ?? undefined) as T | undefined;
  }

  // Fetch a batched tRPC procedure list. Returns the element at `index`
  // (defaults to the last element, matching upstream `.last()`).
  private async fetchTrpc(
    procedures: string,
    input: unknown,
    index?: number,
  ): Promise<unknown> {
    const encoded = encodeURIComponent(JSON.stringify(input));
    const url = `${BASE_URL}/api/trpc/${procedures}?batch=1&input=${encoded}`;
    const arr = await this.fetchJsonWithAuth<unknown[]>(url);
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    if (index != null) return arr[index];
    return arr[arr.length - 1];
  }

  private async fetchJsonWithAuth<T>(url: string): Promise<T> {
    let [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });

    // The API returns 401 until a session cookie is populated by loading
    // the homepage; fetch it once then retry.
    if (response.status === 401) {
      await Application.scheduleRequest({
        url: BASE_URL,
        method: "GET",
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      [response, data] = await Application.scheduleRequest({
        url,
        method: "GET",
      });
    }

    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }
}

export const Hiperdex = new HiperdexExtension();
