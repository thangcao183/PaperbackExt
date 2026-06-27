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

const BASE_URL = "https://www.xomanga.site";

const EXCLUSIVE_REGEX = /myExclusiveWorksTitles\s*=\s*\[([^\]]+)]/s;
const QUOTED_REGEX = /["']([^"'\n]+)["']/g;

interface MangaDto {
  title: string;
  image?: string;
  link: string;
}

interface IndexResponse {
  slider: MangaDto[];
  latest: MangaDto[];
}

interface DetailsResponse {
  title: string;
  description?: string;
  cover?: string;
  tags?: string[];
  status?: string;
}

interface ChapterDto {
  chapter: number;
  link: string;
  date: string;
}

interface ChapterResponse {
  chapters_list: ChapterDto[];
}

interface ImageResponse {
  images: string[];
}

class XoMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
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

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
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

type XoMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class XoMangaExtension implements XoMangaImplementation {
  requestManager = new XoMangaInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
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
      { id: "popular", title: "Exclusive Works", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const index = await this.fetchJson<IndexResponse>({
      url: `${BASE_URL}/index.json`,
      method: "GET",
    });
    const latest = index.latest ?? [];

    let entries = latest;
    if (section.id === "popular") {
      const exclusive = await this.fetchExclusiveTitles();
      entries = latest.filter((m) => this.isExclusive(m.title, exclusive));
    }

    const itemType = section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    const items: DiscoverSectionItem[] = [];
    for (const m of entries) {
      const id = this.idFromLink(m.link);
      if (!id) continue;
      items.push({
        type: itemType,
        mangaId: this.toSafeId(id),
        imageUrl: this.imageUrl(m.image),
        title: m.title,
        metadata: undefined,
      });
    }

    return { items, metadata: undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = query.title.trim().toLowerCase();
    const index = await this.fetchJson<IndexResponse>({
      url: `${BASE_URL}/index.json`,
      method: "GET",
    });
    const latest = index.latest ?? [];

    const items: SearchResultItem[] = [];
    for (const m of latest) {
      if (titleQuery.length > 0 && !m.title.toLowerCase().includes(titleQuery)) continue;
      const id = this.idFromLink(m.link);
      if (!id) continue;
      items.push({
        mangaId: this.toSafeId(id),
        imageUrl: this.imageUrl(m.image),
        title: m.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    return { items, metadata: undefined };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.safeDecode(mangaId);
    const details = await this.fetchJson<DetailsResponse>({
      url: `${BASE_URL}/manga/${id}/details.json`,
      method: "GET",
    });

    const tags = (details.tags ?? []).filter((t) => t.trim().length > 0);
    const tagGroups: TagSection[] =
      tags.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: tags.map((t) => ({ id: t.toLowerCase().replace(/\s+/g, "-"), title: t })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: details.title,
        secondaryTitles: [],
        thumbnailUrl: this.imageUrl(details.cover),
        synopsis: (details.description ?? "").trim(),
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(details.status),
        tagGroups,
        shareUrl: `${BASE_URL}/details.html?id=${id}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.safeDecode(sourceManga.mangaId);
    const result = await this.fetchJson<ChapterResponse>({
      url: `${BASE_URL}/manga/${id}/details.json`,
      method: "GET",
    });

    const chapters: Chapter[] = [];
    for (const ch of result.chapters_list ?? []) {
      const slug = this.queryParam(ch.link, "id") ?? id;
      const chapterNum = this.queryParam(ch.link, "ch") ?? String(ch.chapter);
      const numStr = ch.chapter % 1 === 0 ? String(Math.trunc(ch.chapter)) : String(ch.chapter);
      chapters.push({
        chapterId: this.toSafeId(`${slug}#${chapterNum}`),
        sourceManga,
        title: `Chapter ${numStr}`,
        volume: 0,
        chapNum: ch.chapter,
        publishDate: this.parseDate(ch.date),
        langCode: "\ud83c\uddec\ud83c\udde7",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const [slug, chapterNum] = decoded.split("#");
    const result = await this.fetchJson<ImageResponse>({
      url: `${BASE_URL}/manga/${slug}/chapters/${chapterNum}.json`,
      method: "GET",
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: (result.images ?? []).map((url) => this.imageUrl(url)),
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/details.html?id=${this.safeDecode(mangaId)}`;
  }

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

  private async fetchExclusiveTitles(): Promise<Set<string>> {
    const html = await this.fetchString({ url: `${BASE_URL}/our-works.html`, method: "GET" });
    const block = EXCLUSIVE_REGEX.exec(html)?.[1];
    const titles = new Set<string>();
    if (!block) return titles;
    let m: RegExpExecArray | null;
    QUOTED_REGEX.lastIndex = 0;
    while ((m = QUOTED_REGEX.exec(block)) !== null) {
      titles.add(m[1].toLowerCase().trim().replace(/\s+/g, " "));
    }
    return titles;
  }

  private isExclusive(title: string, exclusive: Set<string>): boolean {
    const normalised = title.toLowerCase().trim().replace(/\s+/g, " ");
    for (const t of exclusive) {
      if (normalised.includes(t)) return true;
    }
    return false;
  }

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  private async fetchString(request: Request): Promise<string> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return Application.arrayBufferToUTF8String(data);
  }

  private idFromLink(link: string): string {
    return this.queryParam(link, "id") ?? "";
  }

  private queryParam(url: string, key: string): string | undefined {
    const m = new RegExp(`[?&]${key}=([^&#]*)`).exec(url);
    return m ? this.safeDecode(m[1]) : undefined;
  }

  private imageUrl(url?: string): string {
    if (!url) return "";
    if (/^https?:\/\//.test(url)) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `${BASE_URL}${url}`;
    return `${BASE_URL}/${url}`;
  }

  private parseStatus(status?: string): string {
    switch ((status ?? "").toLowerCase()) {
      case "ongoing":
        return "Ongoing";
      case "completed":
        return "Completed";
      case "hiatus":
        return "Hiatus";
      case "cancelled":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const d = new Date(value);
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
}

export const XoManga = new XoMangaExtension();
