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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import {
  descrambleAlphaManga,
  encodeKeyFragment,
  extractPageKeys,
  parseKeyFragment,
} from "./descramble";
import { AlphaMangaSearchForm, AlphaMangaSearchMeta } from "./forms";
import { AlphaMangaSettingsForm, getHideLocked } from "./settings";

const BASE_URL = "https://www.alpha-manga.com";

// Upstream loads the DETAIL page with a desktop UA because the mobile layout
// uses different markup than the selectors expect, and loads the VIEWER with a
// mobile UA because the site only serves high-resolution page images to mobile.
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";

interface AlphaMangaMetadata {
  page?: number;
}

// ---- Upstream JSON DTOs (Dto.kt) ----

/** `/manga/search.json` response. */
interface ApiSearchResponse {
  data?: ApiMangaData[];
  has_more?: boolean;
}

interface ApiMangaData {
  manga_sele_id: number;
  title: string;
  banner_image_url?: string | null;
}

/** `/manga/{id}/episodes.json` response. */
interface ApiChapterResponse {
  episodes?: ApiEpisode[];
}

interface ApiEpisode {
  story_no?: number | null;
  episode_no: number;
  title: string;
  update_date?: string | null;
  status?: string | null;
  is_purchased?: boolean | null;
  is_on_rental?: boolean | null;
}

class AlphaMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    };
    // Requests that need a specific UA set it themselves; everything else gets
    // the app default.
    if (!request.headers["user-agent"]) {
      request.headers["user-agent"] = await Application.getDefaultUserAgent();
    }
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

    // Upstream #18522: page images are tile-scrambled; the per-page key rides
    // along in the URL fragment set by getChapterDetails.
    const key = parseKeyFragment(request.url);
    if (key && response.status >= 200 && response.status < 300) {
      try {
        const mimeType = response.mimeType || "image/webp";
        return await descrambleAlphaManga(data, key, mimeType);
      } catch {
        // Never throw from interceptResponse — a scrambled page still beats a
        // blank one.
        return data;
      }
    }

    return data;
  }
}

type AlphaMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class AlphaMangaExtension implements AlphaMangaImplementation {
  requestManager = new AlphaMangaInterceptor("main");
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

  async getSettingsForm(): Promise<Form> {
    return new AlphaMangaSettingsForm();
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    // Upstream sets `supportsLatest = false`; popular is the unfiltered search.
    return [
      {
        id: "popular",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as AlphaMangaMetadata | undefined)?.page ?? 1;
    const result = await this.fetchSearch(page, "", "", "");

    const items: DiscoverSectionItem[] = result.entries.map((m) => ({
      type: "featuredCarouselItem",
      mangaId: this.toSafeId(String(m.manga_sele_id)),
      imageUrl: m.banner_image_url ?? "",
      title: m.title,
      metadata: undefined,
    }));

    return {
      items,
      metadata: result.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(): Promise<AdvancedSearchForm> {
    return new AlphaMangaSearchForm();
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as AlphaMangaMetadata | undefined)?.page ?? 1;
    const searchMeta = (
      query.metadata as { searchMeta?: AlphaMangaSearchMeta } | undefined
    )?.searchMeta;

    const result = await this.fetchSearch(
      page,
      (query.title || "").trim(),
      searchMeta?.status?.[0] ?? "",
      searchMeta?.genre?.[0] ?? "",
    );

    const items: SearchResultItem[] = result.entries.map((m) => ({
      mangaId: this.toSafeId(String(m.manga_sele_id)),
      imageUrl: m.banner_image_url ?? "",
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items,
      metadata: result.hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.safeDecode(mangaId);
    const $ = await this.fetchCheerio({
      url: `${BASE_URL}/manga/${id}`,
      method: "GET",
      headers: { "user-agent": DESKTOP_UA },
    });

    const title = $("h1.c-h1").first().text().trim();

    // The "about" block is a flat list of labels; author and illustrator are
    // distinguished by the trailing role text ("<name> / Author").
    const labels = $("h3.p-manga-detail__about-label")
      .toArray()
      .map((el) => $(el).text().trim());
    const author = labels
      .filter((t) => t.includes("Author"))
      .map((t) => this.stripRole(t))
      .filter((t) => t.length > 0)
      .join(", ");
    const artist = labels
      .filter((t) => t.includes("Illustrator"))
      .map((t) => this.stripRole(t))
      .filter((t) => t.length > 0)
      .join(", ");

    const synopsis = $("p.p-manga-detail__about-overview-text")
      .first()
      .text()
      .trim();

    const genres = $(".p-manga-detail__tags .c-tag")
      .toArray()
      .map((el) => $(el).text().trim())
      .filter((t) => t.length > 0);
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

    const thumbnailUrl =
      $("img.p-manga-detail__banner-image").first().attr("src") || "";

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: this.absoluteUrl(thumbnailUrl),
        author: author.length > 0 ? author : undefined,
        artist: artist.length > 0 ? artist : undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(
          $(".p-manga-detail__status p").first().text().trim(),
        ),
        tagGroups,
        shareUrl: `${BASE_URL}/manga/${id}`,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.safeDecode(sourceManga.mangaId);
    const [response, data] = await Application.scheduleRequest({
      url: `${BASE_URL}/manga/${id}/episodes.json`,
      method: "GET",
    });
    if (response.status === 404) throw new Error("Content not found");

    const parsed = this.parseJson<ApiChapterResponse>(data);
    const episodes = parsed?.episodes ?? [];
    const hideLocked = getHideLocked();

    const chapters: Chapter[] = [];
    for (const episode of episodes) {
      const locked = this.isLocked(episode);
      if (hideLocked && locked) continue;

      chapters.push({
        // The viewer URL is `/manga/{titleId}/{episodeNo}`, so both ids must be
        // kept to build it later.
        chapterId: this.toSafeId(`${id}/${episode.episode_no}`),
        sourceManga,
        title: `${locked ? "🔒 " : ""}${episode.title}`,
        volume: 0,
        chapNum: episode.story_no ?? -1,
        publishDate: this.parseDate(episode.update_date),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetchCheerio({
      url: this.chapterUrl(chapter.chapterId),
      method: "GET",
      // Mobile UA yields the high-resolution page images.
      headers: { "user-agent": MOBILE_UA },
    });

    const viewer = $("viewer-manga-vertical").first();
    const raw = viewer.attr("v-bind:pages");
    if (!raw) {
      throw new Error(
        "Log in via the browser and rent or purchase this chapter to read it.",
      );
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Unexpected page list format");
    }

    // The list is padded with "first"/"last" sentinels that are not images.
    const urls = parsed.filter(
      (p): p is string =>
        typeof p === "string" && p !== "first" && p !== "last",
    );

    // Upstream #18522: pages are tile-scrambled and each one has its own key,
    // packed into the viewer's `placeholder` PNG. Attach the key to the URL as
    // a fragment (never transmitted over HTTP) so the response interceptor can
    // unscramble the bytes. When the keys are missing or don't line up we fall
    // back to the plain URLs rather than failing the chapter.
    const keys = extractPageKeys(viewer.attr("placeholder") ?? "");
    const keyed = keys.length === urls.length;

    const pages = urls.map((p, i) => {
      const absolute = this.absoluteUrl(p);
      return keyed ? absolute + encodeKeyFragment(keys[i]) : absolute;
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/manga/${this.safeDecode(mangaId)}`;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private async fetchSearch(
    page: number,
    query: string,
    status: string,
    genre: string,
  ): Promise<{ entries: ApiMangaData[]; hasNextPage: boolean }> {
    const url =
      `${BASE_URL}/manga/search.json` +
      `?query=${encodeURIComponent(query)}` +
      `&progress=${encodeURIComponent(status)}` +
      `&genre=${encodeURIComponent(genre)}` +
      `&page=${page}`;

    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      return { entries: [], hasNextPage: false };
    }

    const parsed = this.parseJson<ApiSearchResponse>(data);
    return {
      entries: parsed?.data ?? [],
      hasNextPage: parsed?.has_more === true,
    };
  }

  /**
   * Upstream `Episode.isLocked`: a chapter is readable when it is free, already
   * purchased, or currently rented. Anything else needs a transaction on the
   * site and cannot be opened here.
   */
  private isLocked(episode: ApiEpisode): boolean {
    return (
      episode.status !== "free" &&
      episode.is_purchased === false &&
      episode.is_on_rental === false
    );
  }

  /** `"Tomomi Mizuna / Author"` -> `"Tomomi Mizuna"`. */
  private stripRole(text: string): string {
    const idx = text.lastIndexOf("/");
    return (idx >= 0 ? text.slice(0, idx) : text).trim();
  }

  private chapterUrl(chapterId: string): string {
    // chapterId = "{titleId}/{episodeNo}"
    return `${BASE_URL}/manga/${this.safeDecode(chapterId)}?mode=vertical`;
  }

  private parseStatus(status: string): string {
    switch (status.trim()) {
      case "Ongoing":
        return "Ongoing";
      case "Completed":
        return "Completed";
      case "Suspended":
        return "Hiatus";
      default:
        return "Unknown";
    }
  }

  /** Upstream date format: `"MMM d, yyyy HH:mm"` (e.g. "Aug 7, 2026 01:00"). */
  private parseDate(value?: string | null): Date {
    if (!value) return new Date(0);
    const t = Date.parse(value.trim());
    return isNaN(t) ? new Date(0) : new Date(t);
  }

  private parseJson<T>(data: ArrayBuffer): T | undefined {
    try {
      return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
    } catch {
      return undefined;
    }
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
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

export const AlphaManga = new AlphaMangaExtension();
