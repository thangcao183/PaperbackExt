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
import { ScansGGSearchForm, ScansGGSearchMeta, TAG_OPTIONS } from "./forms";

const BASE_URL = "https://scans.gg";
const API_URL = "https://api.scans.gg";
const CDN_URL = "https://cdn.scans.gg/uploads";
const POPULAR_LIMIT = 21;
const LATEST_LIMIT = 14;
const CHAPTER_LIMIT = 100;

const TAG_MAP: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const t of TAG_OPTIONS) map[parseInt(t.id, 10)] = t.title;
  return map;
})();

interface MetaDto {
  has_more?: boolean;
}

interface ResponseDto<T> {
  data: T;
  meta?: MetaDto;
}

interface SeriesDto {
  id: number;
  title: string;
  summary?: string;
  cover?: string;
  author?: string[];
  artist?: string[];
  tags?: number[];
  status?: number;
}

interface GroupDto {
  title?: string;
}

interface ChapterDto {
  id: number;
  number: number;
  title?: string;
  created_at?: string;
  group_id?: number;
  group?: GroupDto;
}

interface PageDto {
  position: number;
  path: string;
}

interface ChapterDataDto {
  id?: number;
  pages?: PageDto[];
}

interface PageListDto {
  chapter?: ChapterDataDto;
}

class ScansGGInterceptor extends PaperbackInterceptor {
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

type ScansGGImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class ScansGGExtension implements ScansGGImplementation {
  requestManager = new ScansGGInterceptor("main");
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
      { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;

    if (section.id === "latest") {
      const data = await this.fetchJson<ResponseDto<SeriesDto[]>>({
        url:
          `${API_URL}/chapters?page=${page}&limit=${LATEST_LIMIT}` +
          `&chapters=true&series_details=true&group_details=true&sort=date`,
        method: "GET",
      });
      const items: DiscoverSectionItem[] = (data.data ?? []).map((s) => ({
        type: "simpleCarouselItem",
        mangaId: this.toSafeId(String(s.id)),
        imageUrl: this.coverUrl(s.cover),
        title: s.title,
        metadata: undefined,
      }));
      return { items, metadata: data.meta?.has_more ? { page: page + 1 } : undefined };
    }

    const data = await this.fetchJson<ResponseDto<SeriesDto[]>>({
      url: `${API_URL}/series?limit=${POPULAR_LIMIT}&offset=${(page - 1) * POPULAR_LIMIT}`,
      method: "GET",
    });
    const list = data.data ?? [];
    const items: DiscoverSectionItem[] = list.map((s) => ({
      type: "featuredCarouselItem",
      mangaId: this.toSafeId(String(s.id)),
      imageUrl: this.coverUrl(s.cover),
      title: s.title,
      metadata: undefined,
    }));
    return { items, metadata: list.length === POPULAR_LIMIT ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (query.metadata as { searchMeta?: ScansGGSearchMeta } | undefined)
      ?.searchMeta;

    const params: string[] = [
      `limit=${POPULAR_LIMIT}`,
      `offset=${(page - 1) * POPULAR_LIMIT}`,
    ];
    if (titleQuery.length > 0) params.push(`q=${encodeURIComponent(titleQuery)}`);
    params.push(`q_type=${encodeURIComponent(`[${(searchMeta?.types ?? []).join(",")}]`)}`);
    params.push(`q_status=${encodeURIComponent(`[${(searchMeta?.statuses ?? []).join(",")}]`)}`);
    params.push(`q_tags=${encodeURIComponent(`[${(searchMeta?.tags ?? []).join(",")}]`)}`);

    const data = await this.fetchJson<ResponseDto<SeriesDto[]>>({
      url: `${API_URL}/series?${params.join("&")}`,
      method: "GET",
    });
    const list = data.data ?? [];
    const items: SearchResultItem[] = list.map((s) => ({
      mangaId: this.toSafeId(String(s.id)),
      imageUrl: this.coverUrl(s.cover),
      title: s.title,
      subtitle: undefined,
      metadata: undefined,
    }));
    return { items, metadata: list.length === POPULAR_LIMIT ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: ScansGGSearchMeta } | undefined)?.searchMeta;
    return new ScansGGSearchForm(meta);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const seriesId = this.safeDecode(mangaId);
    const data = await this.fetchJson<ResponseDto<SeriesDto>>({
      url: `${API_URL}/series?id=${encodeURIComponent(seriesId)}&trackers=true&sources=true`,
      method: "GET",
    });
    const s = data.data;

    const genreNames = (s.tags ?? [])
      .map((t) => TAG_MAP[t])
      .filter((t): t is string => Boolean(t));
    const tagGroups: TagSection[] =
      genreNames.length > 0
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
        primaryTitle: s.title,
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(s.cover),
        author: s.author && s.author.length > 0 ? s.author.join(", ") : undefined,
        artist: s.artist && s.artist.length > 0 ? s.artist.join(", ") : undefined,
        synopsis: (s.summary ?? "").trim(),
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(s.status),
        tagGroups,
        shareUrl: `${BASE_URL}/series/${seriesId}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const seriesId = this.safeDecode(sourceManga.mangaId);
    const chapters: Chapter[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await this.fetchJson<ResponseDto<ChapterDto[]>>({
        url:
          `${API_URL}/chapters?series_id=${encodeURIComponent(seriesId)}` +
          `&limit=${CHAPTER_LIMIT}&page=${page}&group_details=true`,
        method: "GET",
      });
      for (const ch of data.data ?? []) {
        const numStr = String(ch.number).replace(/\.0$/, "");
        let name = `Chapter ${numStr}`;
        if (ch.title && ch.title.length > 0) name += ` - ${ch.title}`;
        const path = `/chapter-navigation?series_id=${seriesId}&chapter_id=${ch.id}&group_id=${ch.group_id ?? 0}`;
        chapters.push({
          chapterId: this.toSafeId(path),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: ch.number,
          publishDate: this.parseDate(ch.created_at),
          langCode: "\ud83c\uddec\ud83c\udde7",
        });
      }
      hasMore = data.meta?.has_more === true;
      page++;
      if (page > 100) break;
    }
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = this.safeDecode(chapter.chapterId);
    const data = await this.fetchJson<ResponseDto<PageListDto>>({
      url: `${API_URL}${path}`,
      method: "GET",
    });
    const ch = data.data.chapter;
    const chapterId = ch?.id;
    const pages =
      chapterId != null && ch?.pages
        ? ch.pages.map((p) => `${CDN_URL}/pages/${chapterId}/${p.path}`)
        : [];
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/series/${this.safeDecode(mangaId)}`;
  }

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

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  private coverUrl(cover?: string): string {
    if (!cover) return "";
    return `${CDN_URL}/covers/${cover}`;
  }

  private parseStatus(status?: number): string {
    switch (status) {
      case 1:
        return "Ongoing";
      case 2:
        return "Completed";
      case 3:
      case 4:
      case 5:
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
    const d = new Date(iso);
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

export const ScansGG = new ScansGGExtension();
