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
import { URLBuilder } from "../url-builder/base";
import {
  getApiUrlOverride,
  getBaseUrlOverride,
  MonochromeSettingsForm,
} from "./settings";

export interface MonochromeConfig {
  name: string;
  baseUrl: string;
  /**
   * Monochrome serves its JSON API from a host derived as `api.<host>` by
   * default, but self-hosted installations use a fully custom endpoint, so an
   * explicit value can be supplied.
   */
  apiUrl?: string;
  contentRating?: ContentRating;
  langCode?: string;
}

// --- JSON DTO shapes (subset of the keiyoushi Monochrome DTOs) ---

interface MonochromeManga {
  id: string;
  title: string;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  version?: number | null;
}

interface MonochromeResults {
  offset?: number;
  limit?: number;
  results: MonochromeManga[];
  total?: number;
}

interface MonochromeChapter {
  id: string;
  name?: string | null;
  volume?: number | null;
  number: number;
  scanGroup?: string | null;
  version: number;
  length: number;
  uploadTime?: string | null;
}

class MonochromeInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    request.headers = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
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
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
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

type MonochromeImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MonochromeExtension implements MonochromeImplementation {
  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly defaultApiUrl: string;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  static readonly MAX_SEARCH_PAGES = 5;
  static readonly PER_PAGE = 10;

  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  get apiUrl(): string {
    return getApiUrlOverride(this.sourceName) ?? this.defaultApiUrl;
  }

  requestManager: MonochromeInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MonochromeConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.defaultApiUrl = (
      config.apiUrl ?? this.deriveApiUrl(config.baseUrl)
    ).replace(/\/+$/, "");
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";
    this.requestManager = new MonochromeInterceptor("main", () => this.baseUrl);
  }

  private deriveApiUrl(baseUrl: string): string {
    return baseUrl.replace(/^(https?:\/\/)/, "$1api.");
  }

  async getSettingsForm(): Promise<Form> {
    return new MonochromeSettingsForm(
      this.sourceName,
      this.defaultBaseUrl,
      this.defaultApiUrl,
    );
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    // Monochrome has no "latest" feed; only a title listing is available.
    return [
      {
        id: "popular_section",
        title: "All Titles",
        type: DiscoverSectionType.featured,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id !== "popular_section") {
      return { items: [] };
    }

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const { mangas, total } = await this.fetchMangaList("", page);

    const items: DiscoverSectionItem[] = mangas.map((manga) => ({
      type: "featuredCarouselItem",
      mangaId: this.toSafeId(manga.id),
      imageUrl: this.coverUrl(manga),
      title: manga.title,
      metadata: undefined,
    }));

    const hasNextPage = page * MonochromeExtension.PER_PAGE < total;
    const reachedPageLimit = page >= MonochromeExtension.MAX_SEARCH_PAGES;

    return {
      items,
      metadata:
        hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    const page =
      typeof (metadata as { page?: number } | undefined)?.page === "number"
        ? (metadata as { page: number }).page
        : 1;

    const { mangas, total } = await this.fetchMangaList(titleQuery, page);

    const results: SearchResultItem[] = mangas.map((manga) => ({
      mangaId: this.toSafeId(manga.id),
      imageUrl: this.coverUrl(manga),
      title: manga.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage = page * MonochromeExtension.PER_PAGE < total;
    const reachedPageLimit = page >= MonochromeExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit ? { page: page + 1 } : undefined,
    };
  }

  private async fetchMangaList(
    title: string,
    page: number,
  ): Promise<{ mangas: MonochromeManga[]; total: number }> {
    const offset = (page - 1) * MonochromeExtension.PER_PAGE;
    const builder = new URLBuilder(this.apiUrl)
      .addPath("manga")
      .addQuery("limit", MonochromeExtension.PER_PAGE.toString())
      .addQuery("offset", offset.toString());
    if (title) builder.addQuery("title", title);

    const data = await this.fetchJson<MonochromeResults>({
      url: builder.build(),
      method: "GET",
    });

    return {
      mangas: data.results ?? [],
      total: data.total ?? 0,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const uuid = this.safeDecode(mangaId);
    const url = new URLBuilder(this.apiUrl)
      .addPath("manga")
      .addPath(uuid)
      .build();

    const manga = await this.fetchJson<MonochromeManga>({
      url,
      method: "GET",
    });

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.title,
        secondaryTitles: [],
        thumbnailUrl: this.coverUrl(manga),
        author: this.cleanField(manga.author),
        artist: this.cleanField(manga.artist),
        synopsis: this.stripHtml(manga.description ?? ""),
        contentRating: this.contentRating,
        status: this.parseStatus(manga.status ?? ""),
        tagGroups: [] as TagSection[],
        shareUrl: this.getMangaShareUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const uuid = this.safeDecode(sourceManga.mangaId);
    const url = new URLBuilder(this.apiUrl)
      .addPath("manga")
      .addPath(uuid)
      .addPath("chapters")
      .build();

    const data = await this.fetchJson<MonochromeChapter[]>({
      url,
      method: "GET",
    });

    const chapters: Chapter[] = [];
    for (const ch of data ?? []) {
      // Composite id encodes everything needed to build the page URLs:
      //   {mangaUuid}/{chapterId}|{version}|{length}
      const chapterId = this.toSafeId(
        `${uuid}/${ch.id}|${ch.version}|${ch.length}`,
      );

      chapters.push({
        chapterId,
        sourceManga,
        title: this.buildChapterName(ch),
        volume: ch.volume ?? 0,
        chapNum:
          typeof ch.number === "number" && !isNaN(ch.number) ? ch.number : -1,
        publishDate: this.parseDate(ch.uploadTime ?? ""),
        langCode: this.langCode,
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const composite = this.safeDecode(chapter.chapterId);
    const parts = composite.split("|");
    const mediaPath = parts[0]; // {mangaUuid}/{chapterId}
    const version = parts[1] ?? "";
    const length = parseInt(parts[2] ?? "0", 10);

    const pages: string[] = [];
    for (let i = 1; i <= length; i++) {
      pages.push(
        `${this.apiUrl}/media/${mediaPath}/${i}.jpg?version=${version}`,
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(mangaId: string): string {
    const uuid = this.safeDecode(mangaId);
    return new URLBuilder(this.baseUrl)
      .addPath("manga")
      .addPath(uuid)
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private coverUrl(manga: MonochromeManga): string {
    const version = manga.version ?? 0;
    return `${this.apiUrl}/media/${manga.id}/cover.jpg?version=${version}`;
  }

  private buildChapterName(ch: MonochromeChapter): string {
    const num = ch.number;
    const numStr =
      typeof num === "number" && !isNaN(num) ? String(num) : "";
    const prefix = ch.volume != null ? `Vol ${ch.volume} ` : "";
    const base = numStr ? `${prefix}Chapter ${numStr}` : `${prefix}Chapter`;
    const name = (ch.name ?? "").trim();
    return name ? `${base} - ${name}` : base;
  }

  private safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
  }

  private cleanField(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (!v || v === "-" || v.toLowerCase() === "n/a") return undefined;
    return v;
  }

  private stripHtml(html: string): string {
    if (!html) return "";
    return html
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

  private parseStatus(status: string): string {
    switch (status.toLowerCase()) {
      case "ongoing":
      case "hiatus":
        return "Ongoing";
      case "completed":
      case "cancelled":
      case "canceled":
        return "Completed";
      default:
        return "Unknown";
    }
  }

  private parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date();
  }

  // ----------------------------------------------------------------
  // Cloudflare + fetch
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
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
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
