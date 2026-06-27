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
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://yaoitoon.net";

interface YaoiToonMetadata {
  page?: number;
}

interface YaoiToonSearchMeta {
  genre?: string;
  sort?: string;
}

const GENRES: { id: string; title: string }[] = [
  { id: "30", title: "4 koma" },
  { id: "38", title: "Action" },
  { id: "1", title: "Adaptation" },
  { id: "24", title: "Adult" },
  { id: "54", title: "Adventure" },
  { id: "39", title: "Age Gap" },
  { id: "104", title: "Aliens" },
  { id: "43", title: "Animals" },
  { id: "106", title: "Anthology" },
  { id: "86", title: "Artbook" },
  { id: "92", title: "Bara(ML)" },
  { id: "17", title: "Beasts" },
  { id: "101", title: "Bloody" },
  { id: "119", title: "Boys" },
  { id: "110", title: "Cartoon" },
  { id: "52", title: "Cheating/Infidelity" },
  { id: "44", title: "Childhood Friends" },
  { id: "84", title: "Chinese" },
  { id: "26", title: "College life" },
  { id: "13", title: "Comedy" },
  { id: "67", title: "Comic" },
  { id: "74", title: "Cooking" },
  { id: "69", title: "Crime" },
  { id: "97", title: "Crossdressing" },
  { id: "68", title: "Delinquents" },
  { id: "120", title: "Dementia" },
  { id: "31", title: "Demons" },
  { id: "122", title: "Doujinshi" },
  { id: "2", title: "Drama" },
  { id: "32", title: "Dungeons" },
  { id: "76", title: "Ecchi" },
  { id: "115", title: "Fan colored" },
  { id: "16", title: "Fantasy" },
  { id: "102", title: "Fetish" },
  { id: "3", title: "Full color" },
  { id: "33", title: "Game" },
  { id: "51", title: "Gender Bender" },
  { id: "108", title: "Ghosts" },
  { id: "71", title: "Gore" },
  { id: "25", title: "Harem" },
  { id: "123", title: "Hentai" },
  { id: "18", title: "Historical" },
  { id: "72", title: "Horror" },
  { id: "124", title: "Incest" },
  { id: "19", title: "Isekai" },
  { id: "90", title: "Japanese" },
  { id: "53", title: "Josei" },
  { id: "93", title: "Josei(W)" },
  { id: "49", title: "Korean" },
  { id: "55", title: "Long strip" },
  { id: "73", title: "Mafia" },
  { id: "34", title: "Magic" },
  { id: "45", title: "Manga" },
  { id: "20", title: "Manhua" },
  { id: "4", title: "Manhwa" },
  { id: "65", title: "Martial Arts" },
  { id: "5", title: "Mature" },
  { id: "112", title: "Mecha" },
  { id: "70", title: "Medical" },
  { id: "80", title: "Military" },
  { id: "100", title: "Monster girls" },
  { id: "35", title: "Monsters" },
  { id: "61", title: "Music" },
  { id: "75", title: "Mystery" },
  { id: "126", title: "Netorare/NTR" },
  { id: "121", title: "Non-human" },
  { id: "116", title: "NTR" },
  { id: "28", title: "Office workers" },
  { id: "57", title: "Official colored" },
  { id: "60", title: "Omegaverse" },
  { id: "87", title: "One shot" },
  { id: "105", title: "Oneshot" },
  { id: "83", title: "Parody" },
  { id: "89", title: "Police" },
  { id: "22", title: "Post-Apocalyptic" },
  { id: "47", title: "Psychological" },
  { id: "118", title: "Regression" },
  { id: "46", title: "Reincarnation" },
  { id: "99", title: "Reverse harem" },
  { id: "6", title: "Romance" },
  { id: "81", title: "Royal family" },
  { id: "64", title: "Royalty" },
  { id: "113", title: "Samurai" },
  { id: "14", title: "School life" },
  { id: "40", title: "Sci-fi" },
  { id: "56", title: "Science fiction" },
  { id: "77", title: "Seinen" },
  { id: "94", title: "Seinen(M)" },
  { id: "58", title: "Sexual violence" },
  { id: "27", title: "Shoujo" },
  { id: "98", title: "Shoujo Ai" },
  { id: "50", title: "Shounen" },
  { id: "21", title: "Shounen Ai" },
  { id: "107", title: "Shounen(B)" },
  { id: "7", title: "Showbiz" },
  { id: "8", title: "Slice of Life" },
  { id: "63", title: "SM/BDSM/SUB-DOM" },
  { id: "9", title: "Smut" },
  { id: "66", title: "Sports" },
  { id: "41", title: "Super Power" },
  { id: "117", title: "Superhero" },
  { id: "42", title: "Supernatural" },
  { id: "91", title: "Survival" },
  { id: "95", title: "The elderly" },
  { id: "48", title: "Thriller" },
  { id: "10", title: "Time travel" },
  { id: "79", title: "Tragedy" },
  { id: "125", title: "Transmigration" },
  { id: "103", title: "Uncategorized" },
  { id: "36", title: "Vampires" },
  { id: "62", title: "Video games" },
  { id: "82", title: "Villainess" },
  { id: "37", title: "Violence" },
  { id: "114", title: "Virtual reality" },
  { id: "59", title: "Web comic" },
  { id: "11", title: "Webtoon" },
  { id: "15", title: "Webtoons" },
  { id: "111", title: "Wuxia" },
  { id: "29", title: "Yakuzas" },
  { id: "12", title: "Yaoi" },
  { id: "23", title: "Yaoi(BL)" },
  { id: "78", title: "Yuri" },
  { id: "96", title: "Yuri(GL)" },
  { id: "85", title: "Zombies" },
];

const DATE_REGEX = /(\d+)([a-zA-Z]+)\s+ago/;

class YaoiToonInterceptor extends PaperbackInterceptor {
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

type YaoiToonImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class YaoiToonExtension implements YaoiToonImplementation {
  requestManager = new YaoiToonInterceptor("main");
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
        id: "most-viewd",
        title: "Most Viewed",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest-updated",
        title: "Latest Updates",
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
      const items: DiscoverSectionItem[] = GENRES.map((genre) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: genre.id } as Metadata,
        },
        name: genre.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as YaoiToonMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = `${BASE_URL}/filter/${page}/?sort=${encodeURIComponent(
      section.id,
    )}&sex=All&chapter_count=0`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".manga_list-sbs .mls-wrap .item").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type:
          section.id === "most-viewd"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as YaoiToonMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const searchMeta = query.metadata as YaoiToonSearchMeta | undefined;

    let url: string;
    if (titleQuery !== "") {
      url = `${BASE_URL}/search/${page}/?keyword=${encodeURIComponent(
        titleQuery,
      )}`;
    } else {
      const params: string[] = [];
      params.push(`sort=${encodeURIComponent(searchMeta?.sort ?? "default")}`);
      if (searchMeta?.genre) {
        params.push(`genres=${encodeURIComponent(searchMeta.genre)}`);
      }
      url = `${BASE_URL}/filter/${page}/?${params.join("&")}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    $(".manga_list-sbs .mls-wrap .item").each((_, element) => {
      const parsed = this.itemFromElement($, $(element));
      if (!parsed) return;
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const titleEl = el.find(".manga-name a").first();
    const href = titleEl.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = titleEl.text().trim();
    const imageUrl = this.imageFromElement(el.find(".manga-poster img").first());
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  private hasNextPage($: CheerioAPI): boolean {
    let found = false;
    $("ul.pagination li.page-item a").each((_, el) => {
      if ($(el).text().includes("›")) found = true;
    });
    return found;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $(".anisc-detail .manga-name").first().text().trim() ||
      this.safeDecode(mangaId);
    const thumbnailUrl = this.imageFromElement(
      $(".anisc-poster img").first(),
    );
    const synopsis = $(".description").first().text().trim();

    const genres = $(".genres a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const statusText = $(".item-title:contains(Status) .name").first().text();

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
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const url = this.mangaUrl(sourceManga.mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const elements = $("ul#chapters-list li.chapter-item").toArray();

    elements.forEach((element, index) => {
      const el = $(element);
      const link = el.find("a.item-link").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const name = el.find(".name").first().text().trim();
      const dateText = el.find(".release-time").first().text();
      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(name, elements.length - index),
        publishDate: this.parseRelativeDate(dateText),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const slug = this.safeDecode(chapter.chapterId).replace(/\/+$/, "");
    const chapterApiId = slug.substring(slug.lastIndexOf("/") + 1);
    const url = `${BASE_URL}/ajax/image/list/chap/${chapterApiId}`;

    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }

    const json = JSON.parse(Application.arrayBufferToUTF8String(data)) as {
      status?: boolean;
      html?: string;
    };
    const dom = htmlparser2.parseDocument(json.html || "");
    const $ = cheerio.load(dom);

    const pages: string[] = [];
    $(".separator").each((_, element) => {
      const el = $(element);
      const dataSrc = el.attr("data-src") || "";
      let imageUrl = "";
      if (dataSrc) {
        imageUrl = dataSrc;
      } else {
        imageUrl = el.find("img").first().attr("src") || "";
      }
      if (imageUrl) pages.push(this.absoluteUrl(imageUrl));
    });

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
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    return this.toSafeId(slug);
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

  private parseChapterNumber(name: string, fallback: number): number {
    const m = (name || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
  }

  private parseRelativeDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date(0);
    const match = dateStr.trim().match(DATE_REGEX);
    if (!match) return new Date(0);
    const number = parseInt(match[1], 10);
    if (isNaN(number)) return new Date(0);
    const unit = match[2];
    const now = new Date();
    switch (unit) {
      case "s":
        now.setSeconds(now.getSeconds() - number);
        break;
      case "m":
        now.setMinutes(now.getMinutes() - number);
        break;
      case "M":
        now.setMonth(now.getMonth() - number);
        break;
      case "h":
        now.setHours(now.getHours() - number);
        break;
      case "d":
        now.setDate(now.getDate() - number);
        break;
      case "w":
        now.setDate(now.getDate() - number * 7);
        break;
      case "y":
        now.setFullYear(now.getFullYear() - number);
        break;
      default:
        return new Date(0);
    }
    return now;
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const dataSrc = img.attr("data-src") || "";
    if (dataSrc) return this.absoluteUrl(dataSrc);
    const src =
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

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase().trim();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    if (s.includes("on-hold")) return "Hiatus";
    if (s.includes("canceled")) return "Cancelled";
    return "Unknown";
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

export const YaoiToon = new YaoiToonExtension();
