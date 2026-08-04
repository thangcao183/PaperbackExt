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
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import {
  GENRE_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  WebcomicsSearchForm,
  WebcomicsSearchMeta,
} from "./forms";

const BASE_URL = "https://webcomicsapp.com";
const API_URL = "https://official-website-api.webcomicsapp.com/api/web/v4/book";
const LANG = "en";

// Upstream derives every browse path segment from the filter titles, so the
// first entry of each list doubles as the "no filter" default.
const DEFAULT_GENRE = GENRE_OPTIONS[0].id;
const DEFAULT_STATUS = STATUS_OPTIONS[0].id;
const GENRE_TITLE_SEGMENT = "genres";
// The status option whose presence marks a title as still releasing.
const ONGOING_STATUS = STATUS_OPTIONS[1].title;

interface WebcomicsMetadata {
  page?: number;
}

// mangaId is encoded as "<bookId>|<slug>|<name>" so that the manga and chapter
// page URLs (which need all three segments) can be rebuilt without a lookup.
interface MangaRef {
  bookId: string;
  slug: string;
  name: string;
}

interface MangaInfoResponse {
  data?: {
    name?: string;
    cover?: string;
    category?: string[];
    author?: string;
    description?: string;
    status?: string;
  };
}

interface ChapterDto {
  chapter_id?: string;
  index?: number;
  is_pay?: boolean;
  name?: string;
  update_time?: number;
}

interface ChapterListResponse {
  data?: {
    list?: ChapterDto[];
  };
}

interface ChapterDetailResponse {
  data?: {
    base_url?: string;
    images?: { url?: string }[];
  };
}

class WebcomicsInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

type WebcomicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class WebcomicsExtension implements WebcomicsImplementation {
  requestManager = new WebcomicsInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
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
        title: "Newest",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "genres",
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          metadata: { searchMeta: { genre: [genre.id] } },
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as WebcomicsMetadata | undefined;
    const page = meta?.page ?? 1;

    // Popular uses the first sort option, latest the last one.
    const sort =
      section.id === "popular"
        ? SORT_OPTIONS[0].id
        : SORT_OPTIONS[SORT_OPTIONS.length - 1].id;
    const url = this.browseUrl(DEFAULT_GENRE, DEFAULT_STATUS, sort, page);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const parsed = this.parseListing($);
    const items: DiscoverSectionItem[] = parsed.items.map((item) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: item.mangaId,
      imageUrl: item.imageUrl,
      title: item.title,
      metadata: undefined,
    }));

    return {
      items,
      metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: WebcomicsSearchMeta }
      | undefined;
    return new WebcomicsSearchForm(meta?.searchMeta);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const meta = metadata as WebcomicsMetadata | undefined;
    const page = meta?.page ?? 1;

    // Text search is a dedicated endpoint that ignores the filters entirely.
    if (titleQuery !== "") {
      const url = `${BASE_URL}/${LANG}/search?q=${encodeURIComponent(titleQuery)}`;
      const $ = await this.fetchCheerio({ url, method: "GET" });
      return { items: this.parseListing($).items, metadata: undefined };
    }

    const searchMeta = (
      query.metadata as { searchMeta?: WebcomicsSearchMeta } | undefined
    )?.searchMeta;

    const url = this.browseUrl(
      searchMeta?.genre?.[0] ?? DEFAULT_GENRE,
      searchMeta?.status?.[0] ?? DEFAULT_STATUS,
      searchMeta?.sort?.[0] ?? SORT_OPTIONS[0].id,
      page,
    );
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const parsed = this.parseListing($);
    return {
      items: parsed.items,
      metadata: parsed.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const ref = this.parseMangaId(mangaId);
    const json = await this.fetchJson<MangaInfoResponse>(`${API_URL}/info`, {
      book_id: ref.bookId,
    });
    const data = json.data ?? {};

    const genres = (data.category ?? []).filter((g) => g.length > 0);
    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: data.name ?? ref.name,
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(data.cover ?? ""),
        author: data.author,
        synopsis: data.description ?? "",
        contentRating: ContentRating.EVERYONE,
        status: data.status === ONGOING_STATUS ? "Ongoing" : "Completed",
        tagGroups,
        shareUrl: this.mangaUrl(ref),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const ref = this.parseMangaId(sourceManga.mangaId);
    const json = await this.fetchJson<ChapterListResponse>(
      `${API_URL}/chapter/list`,
      { book_id: ref.bookId, page: 1, size: 9999, sort: "desc" },
    );

    const chapters: Chapter[] = [];
    for (const entry of json.data?.list ?? []) {
      const chapterId = entry.chapter_id;
      if (!chapterId) continue;
      const name = entry.name ?? "";
      const index = entry.index ?? 0;
      chapters.push({
        // The reader page URL needs the chapter index too, so keep both.
        chapterId: `${chapterId}|${index}`,
        sourceManga,
        title: entry.is_pay ? `🔒 ${name}` : name,
        volume: 0,
        chapNum: index,
        publishDate: entry.update_time
          ? new Date(entry.update_time)
          : new Date(0),
        langCode: "🇬🇧",
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const ref = this.parseMangaId(chapter.sourceManga.mangaId);
    const [chapterId, indexPart] = chapter.chapterId.split("|");
    const index = parseInt(indexPart ?? "", 10);

    const json = await this.fetchJson<ChapterDetailResponse>(
      `${API_URL}/chapter/detail`,
      {
        book_id: ref.bookId,
        chapter_id: chapterId,
        index: isNaN(index) ? chapter.chapNum : index,
      },
    );

    const baseUrl = json.data?.base_url ?? "";
    const pages: string[] = [];
    for (const image of json.data?.images ?? []) {
      const url = image.url ?? "";
      if (!url) continue;
      pages.push(url.startsWith("http") ? url : `${baseUrl}${url}`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    return this.mangaUrl(this.parseMangaId(mangaId));
  }

  // ----------------------------------------------------------------
  // Listing parsing
  // ----------------------------------------------------------------

  private parseListing($: CheerioAPI): {
    items: SearchResultItem[];
    hasNextPage: boolean;
  } {
    // Thumbnails are sometimes only present in the Nuxt payload.
    const nuxtData = $("script#__NUXT_DATA__").first().contents().text();

    const items: SearchResultItem[] = [];
    const seen = new Set<string>();
    $(".grid > a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;

      // Hrefs look like /<lang>/<slug>/<name>/<bookId>.
      const segments = this.safeDecode(href)
        .replace(/[?#].*$/, "")
        .replace(/^https?:\/\/[^/]+/, "")
        .split("/")
        .filter((s) => s.length > 0);
      if (segments.length < 4) return;

      const ref: MangaRef = {
        slug: segments[1],
        name: segments[2],
        bookId: segments[3],
      };
      const mangaId = this.toMangaId(ref);
      if (seen.has(mangaId)) return;

      const title = el
        .find("p.text-ink,span[class*=text]")
        .first()
        .text()
        .trim();
      if (!title) return;

      seen.add(mangaId);
      items.push({
        mangaId,
        imageUrl: this.thumbnailFor(el.find("img[src]").first(), ref, nuxtData),
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    // The current page is a non-clickable span; a following anchor means there
    // is at least one more page.
    const hasNextPage =
      $("div > span.cursor-default.bg-primary + a").length > 0;

    return { items, hasNextPage };
  }

  private thumbnailFor(
    img: Cheerio<AnyNode>,
    ref: MangaRef,
    nuxtData: string,
  ): string {
    const src = this.imageFromElement(img);
    if (src.startsWith("http")) return src;
    if (!nuxtData) return src;

    // Nuxt serialises the cover a few slots after the book id.
    const escaped = ref.bookId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
      `"${escaped}"[^"]*"[^"]*"[^"]*"(https[^"]+)"`,
    ).exec(nuxtData);
    return match ? match[1] : src;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private browseUrl(
    genre: string,
    status: string,
    sort: string,
    page: number,
  ): string {
    return [
      BASE_URL,
      LANG,
      GENRE_TITLE_SEGMENT,
      this.toPathSegment(genre),
      this.toPathSegment(status),
      this.toPathSegment(sort),
      String(page),
    ].join("/");
  }

  private toPathSegment(value: string): string {
    return value
      .replace(/[!-/:-@[-`{-~]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  private toMangaId(ref: MangaRef): string {
    return [ref.bookId, ref.slug, ref.name].join("|");
  }

  private parseMangaId(mangaId: string): MangaRef {
    const [bookId, slug, name] = this.safeDecode(mangaId).split("|");
    return { bookId: bookId ?? "", slug: slug ?? "", name: name ?? "" };
  }

  private mangaUrl(ref: MangaRef): string {
    return [BASE_URL, LANG, ref.slug, ref.name, ref.bookId].join("/");
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    return this.absoluteUrl(src);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
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

  private async fetchJson<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }

  async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(htmlStr);
    return cheerio.load(dom);
  }
}

export const Webcomics = new WebcomicsExtension();
