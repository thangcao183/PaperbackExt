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
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://hentaihere.com";
const IMAGE_SERVER_URL = "https://hentaicdn.com";

// Category id -> display name (ported from upstream Filters.kt categoryFilterList).
const CATEGORIES: { id: string; title: string }[] = [
  { id: "t34", title: "Adult" },
  { id: "t7", title: "Anal" },
  { id: "t372", title: "Beastiality" },
  { id: "t20", title: "Big Breasts" },
  { id: "t43", title: "Comedy" },
  { id: "t46", title: "Compilation" },
  { id: "t42", title: "Doujinshi" },
  { id: "t40", title: "Ecchi" },
  { id: "t6", title: "Fantasy" },
  { id: "t14", title: "Futanari" },
  { id: "t302", title: "Guro" },
  { id: "t31", title: "Harem" },
  { id: "t15", title: "Incest" },
  { id: "t2650", title: "Isekai (Otherworld)" },
  { id: "t2158", title: "Korean Comic" },
  { id: "t50", title: "Licensed" },
  { id: "t17", title: "Lolicon" },
  { id: "t30", title: "Mecha" },
  { id: "t2503", title: "No Penetration" },
  { id: "t33", title: "Oneshot" },
  { id: "t23", title: "Rape" },
  { id: "t567", title: "Reverse Harem" },
  { id: "t41", title: "Romance" },
  { id: "t432", title: "Scat" },
  { id: "t48", title: "School Life" },
  { id: "t5", title: "Sci-fi" },
  { id: "t32", title: "Serialized" },
  { id: "t44", title: "Shotacon" },
  { id: "t49", title: "Tragedy" },
  { id: "t47", title: "Uncensored" },
  { id: "t27", title: "Yaoi" },
  { id: "t28", title: "Yuri" },
];

interface HentaiHereMetadata {
  page?: number;
  category?: string;
}

class HentaiHereInterceptor extends PaperbackInterceptor {
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

type HentaiHereImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class HentaiHereExtension implements HentaiHereImplementation {
  requestManager = new HentaiHereInterceptor("main");
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
        id: "most-popular",
        title: "Most Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "newest",
        title: "Newest",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "last-updated",
        title: "Last Updated",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "categories",
        title: "Categories",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "categories") {
      const items: DiscoverSectionItem[] = CATEGORIES.map((cat) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { category: cat.id },
        },
        name: cat.title,
        metadata: { category: cat.id },
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as HentaiHereMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = `${BASE_URL}/directory/${section.id}?page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const parsed = this.parseMangaList($);
    const type =
      section.id === "most-popular"
        ? "featuredCarouselItem"
        : "simpleCarouselItem";

    const items: DiscoverSectionItem[] = parsed.items.map((it) => ({
      type,
      mangaId: it.mangaId,
      imageUrl: it.imageUrl,
      title: it.title,
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

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as HentaiHereMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const category =
      meta?.category ??
      (query.metadata as HentaiHereMetadata | undefined)?.category;

    let url: string;
    if (titleQuery.length > 0) {
      const params = [
        `s=${encodeURIComponent(titleQuery)}`,
        "sort=newest",
        `page=${page}`,
      ];
      url = `${BASE_URL}/search?${params.join("&")}`;
    } else if (category) {
      url = `${BASE_URL}/search/${category}/most-popular?page=${page}`;
    } else {
      url = `${BASE_URL}/directory/most-popular?page=${page}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const parsed = this.parseMangaList($);

    const results: SearchResultItem[] = parsed.items.map((it) => ({
      mangaId: it.mangaId,
      imageUrl: it.imageUrl,
      title: it.title,
      subtitle: it.author,
      metadata: undefined,
    }));

    return {
      items: results,
      metadata: parsed.hasNextPage
        ? { page: page + 1, category }
        : undefined,
    };
  }

  private parseMangaList($: CheerioAPI): {
    items: {
      mangaId: string;
      imageUrl: string;
      title: string;
      author?: string;
    }[];
    hasNextPage: boolean;
  } {
    const items: {
      mangaId: string;
      imageUrl: string;
      title: string;
      author?: string;
    }[] = [];
    const seen = new Set<string>();

    $(".item").each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;

      const img = el.find(".pos-rlt img").first();
      const title = (img.attr("alt") || "").trim();
      const imageUrl = this.absoluteUrl(img.attr("src") || "");
      if (!title || !imageUrl) return;

      const mutedText = el.find("div:not(.pos-rtl) > .text-muted").text();
      const artistName = mutedText.split("by ")[1]?.split(".")[0]?.trim() || "";
      const author =
        artistName && artistName !== "-" && artistName !== "Unknown"
          ? artistName
          : undefined;

      seen.add(mangaId);
      items.push({ mangaId, imageUrl, title, author });
    });

    const lastPage = $(".pagination > li:last-child").first();
    const hasNextPage =
      lastPage.length > 0 && !lastPage.hasClass("disabled");

    return { items, hasNextPage };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title =
      $("h4 > a").first().text().trim() || this.safeDecode(mangaId);

    const author = $("#info .text-info:contains(Artist:) ~ a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((a) => a.length > 0)
      .join(", ");

    let synopsis = $(
      "#info > div:has(> .text-info:contains(Brief Summary:))",
    )
      .first()
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .trim();
    if (synopsis === "Nothing yet!") synopsis = "";

    const categories = $("#info .text-info:contains(Cat) ~ a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
    const contents = $("#info .text-info:contains(Content:) ~ a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);
    const allTags = Array.from(new Set([...categories, ...contents]));

    const isLicensed = categories.includes("Licensed");
    const statusText = $("#info .text-info:contains(Status:) ~ a")
      .first()
      .text()
      .trim();

    const thumbnailUrl = this.absoluteUrl(
      $("#cover img").first().attr("src") || "",
    );

    const tagGroups: TagSection[] = [];
    if (allTags.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: allTags.map((g) => ({
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
        author: author || undefined,
        artist: author || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: isLicensed ? "Cancelled" : this.parseStatus(statusText),
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

    $("li.sub-chp > a").each((index, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!href) return;
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);

      const fullText = el.text().trim();
      const name = fullText.split("(")[0]?.trim() || fullText;
      const numToken = name.split(" ")[0];
      const parsedNum = numToken ? parseFloat(numToken) : NaN;
      const chapNum = Number.isFinite(parsedNum) ? parsedNum : index + 1;

      chapters.push({
        chapterId,
        sourceManga,
        title: name,
        volume: 0,
        chapNum,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const html = Application.arrayBufferToUTF8String(data);

    const pages: string[] = [];
    const marker = "var rff_imageList = ";
    const start = html.indexOf(marker);
    if (start !== -1) {
      const tail = html.slice(start + marker.length);
      const end = tail.indexOf(";");
      const jsonStr = end !== -1 ? tail.slice(0, end) : tail;
      try {
        const list = JSON.parse(jsonStr) as unknown;
        if (Array.isArray(list)) {
          for (const entry of list) {
            if (typeof entry === "string") {
              pages.push(`${IMAGE_SERVER_URL}/hentai${entry}`);
            }
          }
        }
      } catch {
        // leave pages empty on parse failure
      }
    }

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

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
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

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
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

export const HentaiHere = new HentaiHereExtension();
