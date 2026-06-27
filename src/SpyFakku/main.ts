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

const BASE_URL = "https://hentalk.pw";
const API_URL = `${BASE_URL}/api`;
const IMAGE_URL = `${BASE_URL}/image`;

interface SpyFakkuMetadata {
  page?: number;
}

interface HentaiName {
  namespace: string;
  name: string;
}

interface HentaiArchive {
  id: number;
  hash: string;
  title: string;
  thumbnail: number;
  pages: number;
  tags?: HentaiName[] | null;
}

interface HentaiLib {
  archives: HentaiArchive[];
  page: number;
  limit: number;
  total: number;
}

interface ShortHentai {
  hash: string;
  thumbnail: number;
  description?: string | null;
  released_at?: string | null;
  created_at?: string | null;
  tags?: HentaiName[] | null;
  size: number;
  pages: number;
}

class SpyFakkuInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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

type SpyFakkuImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class SpyFakkuExtension implements SpyFakkuImplementation {
  requestManager = new SpyFakkuInterceptor("main");
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
        title: "Latest",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as SpyFakkuMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? "released_at" : "created_at";

    const url = `${API_URL}/library?sort=${sort}&page=${page}`;
    const lib = await this.fetchJson<HentaiLib>({ url, method: "GET" });

    const items: DiscoverSectionItem[] = lib.archives.map((archive) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: this.toMangaId(archive),
      imageUrl: this.coverUrl(archive.hash, archive.thumbnail),
      title: archive.title,
      metadata: undefined,
    }));

    const hasNextPage = lib.page * lib.limit < lib.total;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as SpyFakkuMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const params: string[] = [];
    params.push(`q=${encodeURIComponent(titleQuery)}`);
    params.push(`page=${page}`);
    const url = `${API_URL}/library?${params.join("&")}`;
    const lib = await this.fetchJson<HentaiLib>({ url, method: "GET" });

    const items: SearchResultItem[] = lib.archives.map((archive) => ({
      mangaId: this.toMangaId(archive),
      imageUrl: this.coverUrl(archive.hash, archive.thumbnail),
      title: archive.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage = lib.page * lib.limit < lib.total;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.parseId(mangaId);
    const url = `${API_URL}/g/${id}`;
    const add = await this.fetchJson<ShortHentai>({ url, method: "GET" });

    const tags = add.tags ?? [];
    const byNamespace = (ns: string): HentaiName[] =>
      tags.filter((t) => t.namespace === ns);
    const names = (ns: string): string =>
      byNamespace(ns)
        .map((t) => t.name)
        .join(", ");

    const circles = names("circle");
    const artists = names("artist");
    const author = circles || artists;
    const artist = artists;

    const tagGroups: TagSection[] = [];
    const genreTags = byNamespace("tag");
    if (genreTags.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: genreTags.map((t) => ({
          id: t.name.toLowerCase().replace(/\s+/g, "-"),
          title: t.name,
        })),
      });
    }

    const synopsis = this.buildSynopsis(add);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: this.titleFromId(mangaId),
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(add.hash, add.thumbnail),
        author: author || undefined,
        artist: artist || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: "Completed",
        tagGroups,
        shareUrl: this.shareUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.parseId(sourceManga.mangaId);
    const url = `${API_URL}/g/${id}`;
    const add = await this.fetchJson<ShortHentai>({ url, method: "GET" });

    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate: this.parseDate(add.released_at),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    let hash = this.parseHash(mangaId);
    let pageCount = this.parsePages(mangaId);

    if (!hash || !pageCount) {
      const id = this.parseId(mangaId);
      const url = `${API_URL}/g/${id}`;
      const add = await this.fetchJson<ShortHentai>({ url, method: "GET" });
      hash = add.hash;
      pageCount = add.pages;
    }

    const pages: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      pages.push(`${IMAGE_URL}/${hash}/${i}`);
    }

    return {
      id: chapter.chapterId,
      mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.shareUrl(mangaId);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // mangaId encodes "g/<id>?<pages>&hash=<hash>&title=<title>"
  private toMangaId(archive: HentaiArchive): string {
    const slug = `g/${archive.id}?${archive.pages}&hash=${archive.hash}&title=${encodeURIComponent(archive.title)}`;
    return this.toSafeId(slug);
  }

  private parseId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const m = decoded.match(/g\/(\d+)/);
    return m ? m[1] : decoded.replace(/^\/+/, "").replace(/^g\//, "").replace(/[?#].*$/, "");
  }

  private parseHash(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const m = decoded.match(/hash=([^&]+)/);
    return m ? m[1] : "";
  }

  private parsePages(mangaId: string): number {
    const decoded = this.safeDecode(mangaId);
    const m = decoded.match(/\?(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  private titleFromId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const m = decoded.match(/title=([^&]+)/);
    if (m) return this.safeDecode(m[1]);
    return `Gallery ${this.parseId(mangaId)}`;
  }

  private coverUrl(hash: string, thumbnail: number): string {
    return `${IMAGE_URL}/${hash}/${thumbnail}?type=cover`;
  }

  private shareUrl(mangaId: string): string {
    return `${BASE_URL}/g/${this.parseId(mangaId)}`;
  }

  private buildSynopsis(add: ShortHentai): string {
    const tags = add.tags ?? [];
    const join = (ns: string): string =>
      tags
        .filter((t) => t.namespace === ns)
        .map((t) => t.name)
        .join(", ");
    const parts: string[] = [];
    if (add.description) parts.push(add.description);

    const circles = join("circle");
    if (circles) parts.push(`Circles: ${circles}`);
    const publishers = join("publisher");
    if (publishers) parts.push(`Publishers: ${publishers}`);
    const magazines = join("magazine");
    if (magazines) parts.push(`Magazines: ${magazines}`);
    const events = join("event");
    if (events) parts.push(`Events: ${events}`);
    const parodies = join("parody");
    if (parodies) parts.push(`Parodies: ${parodies}`);

    parts.push(`Pages: ${add.pages}`);
    parts.push(`Size: ${this.formatSize(add.size)}`);
    return parts.join("\n");
  }

  private formatSize(size: number): string {
    if (size >= 300 * 1000 * 1000) {
      return `${(size / (1000.0 * 1000.0 * 1000.0)).toFixed(2)} GB`;
    }
    if (size >= 100 * 1000) {
      return `${(size / (1000.0 * 1000.0)).toFixed(2)} MB`;
    }
    if (size >= 1000) {
      return `${(size / 1000.0).toFixed(2)} kB`;
    }
    return `${size} B`;
  }

  private parseDate(value?: string | null): Date {
    if (!value) return new Date(0);
    const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
    return isNaN(d.getTime()) ? new Date(0) : d;
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
  // Cloudflare + fetch
  // ----------------------------------------------------------------

  async cloudflareBypassCompleted(
    _request: Request,
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

  async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const jsonStr = Application.arrayBufferToUTF8String(data);
    return JSON.parse(jsonStr) as T;
  }
}

export const SpyFakku = new SpyFakkuExtension();
