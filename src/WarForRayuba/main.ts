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
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://xrabohrok.github.io/WarMap";
const SHARE_URL = "https://xrabohrok.github.io/WarMap/#/";
const CUBARI_URL = "https://cubari.moe";
// GitHub API listing of the tools directory that holds the round JSON files.
const CONTENTS_API =
  "https://api.github.com/repos/xrabohrok/WarMap/contents/tools";

interface RoundDto {
  title: string;
  description: string;
  artist: string;
  author: string;
  cover: string;
  chapters: Record<string, ChapterDto>;
}

interface ChapterDto {
  title: string;
  volume: string | number;
  groups: { primary: string };
  last_updated: string | number;
}

interface PageDto {
  description: string;
  src: string;
}

interface GitHubContentEntry {
  name: string;
  download_url: string | null;
}

class WarForRayubaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${SHARE_URL}`,
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

type WarForRayubaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class WarForRayubaExtension implements WarForRayubaImplementation {
  requestManager = new WarForRayubaInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 4,
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
        id: "rounds",
        title: "Rounds",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rounds = await this.fetchRounds();
    const items: DiscoverSectionItem[] = rounds.map((round) => ({
      type: "simpleCarouselItem",
      mangaId: round.mangaId,
      imageUrl: round.cover,
      title: round.title,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim().toLowerCase();
    const rounds = await this.fetchRounds();
    const items: SearchResultItem[] = rounds
      .filter(
        (round) =>
          titleQuery === "" ||
          round.title.toLowerCase().includes(titleQuery),
      )
      .map((round) => ({
        mangaId: round.mangaId,
        imageUrl: round.cover,
        title: round.title,
        subtitle: undefined,
        metadata: undefined,
      }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const round = await this.fetchJson<RoundDto>(this.mangaUrl(mangaId));

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: round.title,
        secondaryTitles: [],
        thumbnailUrl: round.cover,
        author: round.author,
        artist: round.artist,
        synopsis: round.description,
        contentRating: ContentRating.EVERYONE,
        status: "Unknown",
        tagGroups: [],
        shareUrl: SHARE_URL,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const round = await this.fetchJson<RoundDto>(
      this.mangaUrl(sourceManga.mangaId),
    );

    const chapters: Chapter[] = [];
    for (const [number, chapter] of Object.entries(round.chapters)) {
      const chapNum = parseFloat(number);
      const chapterId = this.toSafeId(
        `${CUBARI_URL}${chapter.groups.primary}`,
      );
      chapters.push({
        chapterId,
        sourceManga,
        title: `${number} ${chapter.title}`,
        volume: 0,
        chapNum: isNaN(chapNum) ? 0 : chapNum,
        publishDate: this.parseDate(chapter.last_updated),
        langCode: "🇬🇧",
      });
    }

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pageData = await this.fetchJson<PageDto[]>(
      this.chapterUrl(chapter.chapterId),
    );

    const pages: string[] = [];
    for (const page of pageData) {
      const src = this.absoluteUrl(page.src);
      if (src) pages.push(src);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  getMangaShareUrl(_mangaId: string): string {
    return SHARE_URL;
  }

  // ----------------------------------------------------------------
  // Round listing
  // ----------------------------------------------------------------

  private async fetchRounds(): Promise<
    { mangaId: string; title: string; cover: string }[]
  > {
    const entries = await this.fetchJson<GitHubContentEntry[]>(CONTENTS_API);
    const rounds: { mangaId: string; title: string; cover: string }[] = [];

    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith(".json")) continue;
      if (!entry.download_url) continue;
      try {
        const round = await this.fetchJson<RoundDto>(entry.download_url);
        if (!round.title || !round.chapters) continue;
        rounds.push({
          mangaId: this.toSafeId(entry.download_url),
          title: round.title,
          cover: this.absoluteUrl(round.cover),
        });
      } catch {
        // Skip files that are not valid round descriptors.
        continue;
      }
    }

    return rounds;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${CUBARI_URL}/${slug.replace(/^\/+/, "")}`;
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

  private parseDate(value: string | number): Date {
    const seconds =
      typeof value === "number" ? value : parseInt(value, 10);
    if (isNaN(seconds) || seconds <= 0) return new Date(0);
    return new Date(seconds * 1000);
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

  async fetchJson<T>(url: string): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const jsonStr = Application.arrayBufferToUTF8String(data);
    return JSON.parse(jsonStr) as T;
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

export const WarForRayuba = new WarForRayubaExtension();
