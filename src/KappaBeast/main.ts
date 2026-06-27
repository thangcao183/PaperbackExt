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
import * as cheerio from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { KappaBeastSearchForm, KappaBeastSearchMeta } from "./forms";

const DOMAIN = "kappabeast.com";
const BASE_URL = `https://${DOMAIN}`;
const CDN_URL = `https://strapi.${DOMAIN}`;
const API_URL = `${CDN_URL}/api`;
const PAGE_SIZE = 20;

interface CoverImage {
  url?: string;
}

interface Media {
  coverImage?: CoverImage;
}

interface Category {
  name: string;
}

interface MangaData {
  documentId: string;
  title: string;
  description?: string;
  author?: string;
  manga_status?: string;
  artist?: string;
  slug: string;
  media?: Media[];
  category?: Category[];
}

interface MangaRef {
  documentId: string;
  slug: string;
}

interface ChapterData {
  number: number;
  title?: string;
  createdAt?: string;
  manga: MangaRef;
  htmlContent?: string;
}

interface Pagination {
  page: number;
  pageCount: number;
}

interface ResponseMeta {
  pagination: Pagination;
}

interface SearchResponse {
  data: MangaData[];
  meta: ResponseMeta;
}

interface ChapterResponse {
  data: ChapterData[];
  meta: ResponseMeta;
}

class KappaBeastInterceptor extends PaperbackInterceptor {
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

type KappaBeastImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

class KappaBeastExtension implements KappaBeastImplementation {
  requestManager = new KappaBeastInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
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
    const sort = section.id === "latest" ? "updatedAt:desc" : "";
    const url = this.buildSearchUrl("", page, { sort: sort ? [sort] : [] });
    const result = await this.fetchJson<SearchResponse>({ url, method: "GET" });
    const items: DiscoverSectionItem[] = result.data.map((m) => ({
      type: section.id === "latest" ? "simpleCarouselItem" : "featuredCarouselItem",
      mangaId: this.toSafeId(`${m.slug}#${m.documentId}`),
      imageUrl: this.coverUrl(m),
      title: m.title,
      metadata: undefined,
    }));
    const hasNext = result.meta.pagination.page < result.meta.pagination.pageCount;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (query.metadata as { searchMeta?: KappaBeastSearchMeta } | undefined)
      ?.searchMeta;

    const url = this.buildSearchUrl(titleQuery, page, searchMeta);
    const result = await this.fetchJson<SearchResponse>({ url, method: "GET" });
    const items: SearchResultItem[] = result.data.map((m) => ({
      mangaId: this.toSafeId(`${m.slug}#${m.documentId}`),
      imageUrl: this.coverUrl(m),
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));
    const hasNext = result.meta.pagination.page < result.meta.pagination.pageCount;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<AdvancedSearchForm> {
    const meta = (query.metadata as { searchMeta?: KappaBeastSearchMeta } | undefined)?.searchMeta;
    return new KappaBeastSearchForm(meta);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId).split("#")[0].split("/")[0];
    const url =
      `${API_URL}/mangas?` +
      [
        `filters[slug][$eq]=${encodeURIComponent(slug)}`,
        "populate[media][populate]=*",
        "populate[category][fields][0]=name",
        "pagination[pageSize]=1",
      ].join("&");
    const result = await this.fetchJson<SearchResponse>({ url, method: "GET" });
    const manga = result.data[0];
    if (!manga) throw new Error("Manga not found");

    const genreNames = (manga.category ?? []).map((c) => c.name).filter((n) => n.length > 0);
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
        primaryTitle: manga.title,
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(manga),
        author: manga.author && manga.author.trim().length > 0 ? manga.author.trim() : undefined,
        artist: manga.artist && manga.artist.trim().length > 0 ? manga.artist.trim() : undefined,
        synopsis: (manga.description ?? "").trim(),
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(manga.manga_status),
        tagGroups,
        shareUrl: `${BASE_URL}/series/${manga.slug}#${manga.documentId}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const documentId = this.safeDecode(sourceManga.mangaId).split("#")[1];
    if (!documentId) throw new Error("Invalid manga id");

    const chapters: Chapter[] = [];
    let page = 1;
    for (let guard = 0; guard < 100; guard++) {
      const url =
        `${API_URL}/chapters?` +
        [
          `filters[manga][documentId][$eq]=${encodeURIComponent(documentId)}`,
          "populate[pages][populate]=*",
          "populate=manga",
          "sort[0]=number:desc",
          `pagination[page]=${page}`,
          "pagination[pageSize]=100",
        ].join("&");
      const result = await this.fetchJson<ChapterResponse>({ url, method: "GET" });
      for (const ch of result.data) {
        const numStr = ch.number % 1 === 0 ? String(Math.trunc(ch.number)) : String(ch.number);
        let name = `Chapter ${numStr}`;
        if (ch.title && ch.title.trim().length > 0 && ch.title !== `Chapter ${numStr}`) {
          name += ` - ${ch.title.trim()}`;
        }
        chapters.push({
          chapterId: this.toSafeId(`${ch.manga.slug}/${ch.number}#${ch.manga.documentId}`),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: ch.number,
          publishDate: this.parseDate(ch.createdAt),
          langCode: "\ud83c\uddec\ud83c\udde7",
        });
      }
      if (result.meta.pagination.page >= result.meta.pagination.pageCount) break;
      page++;
    }
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const documentId = decoded.split("#")[1];
    const chapterNum = decoded.split("#")[0].split("/")[1];
    const url =
      `${API_URL}/chapters?` +
      [
        `filters[manga][documentId][$eq]=${encodeURIComponent(documentId ?? "")}`,
        `filters[number][$eq]=${encodeURIComponent(chapterNum ?? "")}`,
        "populate[pages][populate]=*",
        "populate=manga",
        "sort[0]=number:desc",
        "pagination[pageSize]=1",
      ].join("&");
    const result = await this.fetchJson<ChapterResponse>({ url, method: "GET" });
    const html = result.data[0]?.htmlContent;
    if (!html) throw new Error("This chapter contains no pages.");

    const $ = cheerio.load(htmlparser2.parseDocument(html));
    const pages: string[] = [];
    $("div.separator > a").each((_i, el) => {
      const href = $(el).attr("href");
      if (href) pages.push(this.setPathSegment(this.absoluteUrl(href), 4, "s0"));
    });
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

  private buildSearchUrl(
    titleQuery: string,
    page: number,
    searchMeta?: Partial<KappaBeastSearchMeta>,
  ): string {
    const params: string[] = [];
    if (titleQuery.length > 0) {
      params.push(`filters[title][$containsi]=${encodeURIComponent(titleQuery)}`);
    }
    params.push(`pagination[page]=${page}`);
    params.push(`pagination[pageSize]=${PAGE_SIZE}`);
    params.push("populate[media][populate]=*");
    params.push("populate[category][fields][0]=name");

    const genre = searchMeta?.genre?.[0];
    const status = searchMeta?.status?.[0];
    const type = searchMeta?.type?.[0];
    const sort = searchMeta?.sort?.[0];
    if (genre && genre.length > 0) {
      params.push(`filters[category][name][$eq]=${encodeURIComponent(genre)}`);
    }
    if (status && status.length > 0) {
      params.push(`filters[manga_status][$eq]=${encodeURIComponent(status)}`);
    }
    if (type && type.length > 0) {
      params.push(`filters[type][$eq]=${encodeURIComponent(type)}`);
    }
    if (sort && sort.length > 0) {
      params.push(`sort[0]=${encodeURIComponent(sort)}`);
    }
    return `${API_URL}/mangas?${params.join("&")}`;
  }

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  private coverUrl(manga: MangaData): string {
    const path = manga.media?.[0]?.coverImage?.url;
    if (!path) return "";
    return /^https?:\/\//.test(path) ? path : `${CDN_URL}${path}`;
  }

  private absoluteUrl(src: string): string {
    if (/^https?:\/\//.test(src)) return src;
    if (src.startsWith("//")) return `https:${src}`;
    if (src.startsWith("/")) return `${BASE_URL}${src}`;
    return `${BASE_URL}/${src}`;
  }

  private setPathSegment(url: string, index: number, value: string): string {
    try {
      const match = url.match(/^(https?:\/\/[^/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/);
      if (!match) return url;
      const origin = match[1];
      const path = match[2] ?? "";
      const queryHash = (match[3] ?? "") + (match[4] ?? "");
      const segments = path.split("/");
      // segments[0] is "" (leading slash). Strapi setPathSegment is 0-indexed over path segments.
      const segIndex = index + 1;
      if (segIndex < segments.length) {
        segments[segIndex] = value;
      }
      return origin + segments.join("/") + queryHash;
    } catch {
      return url;
    }
  }

  private parseStatus(status?: string): string {
    const s = (status ?? "").toLowerCase();
    if (s === "ongoing") return "Ongoing";
    if (s === "completed") return "Completed";
    return "Unknown";
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

export const KappaBeast = new KappaBeastExtension();
