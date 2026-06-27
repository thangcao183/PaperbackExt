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

const BASE_URL = "https://myhentaigallery.com";

interface MyHentaiGalleryMetadata {
  page?: number;
}

const CATEGORIES: { title: string; id: string }[] = [
  { title: "3D Comic", id: "3" },
  { title: "Ahegao", id: "23" },
  { title: "Anal", id: "25" },
  { title: "Animated", id: "10" },
  { title: "Asian", id: "54" },
  { title: "Ass Expansion", id: "5" },
  { title: "Aunt", id: "6" },
  { title: "BBW", id: "7" },
  { title: "Beastiality", id: "8" },
  { title: "Bimbofication", id: "2049" },
  { title: "Bisexual", id: "9" },
  { title: "Black | Interracial", id: "20" },
  { title: "Body Swap", id: "11" },
  { title: "Bondage", id: "12" },
  { title: "Breast Expansion", id: "13" },
  { title: "Brother", id: "1012" },
  { title: "Bukkake", id: "15" },
  { title: "Catgirl", id: "1201" },
  { title: "Cbt", id: "8133" },
  { title: "Censored", id: "5136" },
  { title: "Cheating", id: "49" },
  { title: "Cosplay", id: "8157" },
  { title: "Cousin", id: "17" },
  { title: "CrimsonCoax", id: "11531" },
  { title: "Crossdressing", id: "43" },
  { title: "Cuntboy", id: "8134" },
  { title: "Dad | Father", id: "788" },
  { title: "Daughter", id: "546" },
  { title: "Dick Growth", id: "21" },
  { title: "Double Penetration", id: "8135" },
  { title: "Ebony", id: "29" },
  { title: "Elf", id: "1714" },
  { title: "Exhibitionism", id: "1838" },
  { title: "Family", id: "2094" },
  { title: "Femboy | Tomgirl | Sissy", id: "8136" },
  { title: "Femdom", id: "24" },
  { title: "Foot Fetish", id: "1873" },
  { title: "Forced", id: "18" },
  { title: "Furry", id: "14" },
  { title: "Futanari | Shemale | Dickgirl", id: "19" },
  { title: "Futanari X Female", id: "1951" },
  { title: "Futanari X Futanari", id: "1885" },
  { title: "Futanari X Male", id: "26" },
  { title: "Gangbang", id: "27" },
  { title: "Gay | Yaoi", id: "28" },
  { title: "Gender Bender", id: "16" },
  { title: "Giant", id: "8137" },
  { title: "Giantess", id: "452" },
  { title: "Gilf", id: "8138" },
  { title: "Gloryhole", id: "31" },
  { title: "Group", id: "101" },
  { title: "Hairy Female", id: "1986" },
  { title: "Hardcore", id: "36" },
  { title: "Harem", id: "53" },
  { title: "Inflation | Stomach Bulge", id: "57" },
  { title: "Inseki", id: "1978" },
  { title: "Kemonomimi", id: "1875" },
  { title: "Lactation", id: "39" },
  { title: "Legendary", id: "6293" },
  { title: "Lesbian | Yuri | Girls Only", id: "41" },
  { title: "Milf", id: "30" },
  { title: "Mind Break", id: "2023" },
  { title: "Mind Control | Hypnosis", id: "42" },
  { title: "Mom | Mother", id: "56" },
  { title: "Monster", id: "8140" },
  { title: "Monster Girl", id: "8139" },
  { title: "Most Popular", id: "52" },
  { title: "Muscle Girl", id: "45" },
  { title: "Muscle Growth", id: "46" },
  { title: "Nephew", id: "47" },
  { title: "Niece", id: "48" },
  { title: "Nipple Fuck | Nipple Penetration", id: "8141" },
  { title: "Pegging", id: "50" },
  { title: "Possession", id: "51" },
  { title: "Pregnant | Impregnation", id: "55" },
  { title: "Public Use", id: "8142" },
  { title: "Selfcest", id: "8143" },
  { title: "Sister", id: "58" },
  { title: "Slave", id: "8144" },
  { title: "Smegma", id: "8145" },
  { title: "Solo", id: "1865" },
  { title: "Solo Futa", id: "8154" },
  { title: "Solo Girl", id: "8146" },
  { title: "Solo Male", id: "8147" },
  { title: "Son", id: "62" },
  { title: "Spanking", id: "38" },
  { title: "Speechless", id: "8148" },
  { title: "Strap-On", id: "61" },
  { title: "Stuck In Wall", id: "8149" },
  { title: "Superheroes", id: "59" },
  { title: "Tentacles", id: "60" },
  { title: "Threesome", id: "40" },
  { title: "Tickling", id: "2065" },
  { title: "Titty Fuck | Paizuri", id: "8150" },
  { title: "Tomboy", id: "8153" },
  { title: "Transformation", id: "37" },
  { title: "Uncle", id: "63" },
  { title: "Urination", id: "64" },
  { title: "Vanilla | Wholesome", id: "8151" },
  { title: "Variant Set", id: "8152" },
  { title: "Vore | Unbirth", id: "65" },
  { title: "Weight Gain", id: "66" },
];

class MyHentaiGalleryInterceptor extends PaperbackInterceptor {
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

type MyHentaiGalleryImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class MyHentaiGalleryExtension
  implements MyHentaiGalleryImplementation
{
  requestManager = new MyHentaiGalleryInterceptor("main");
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
        id: "views",
        title: "Most Viewed",
        type: DiscoverSectionType.featured,
      },
      {
        id: "gpage",
        title: "Newest",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "favorites",
        title: "Most Favorited",
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

    const meta = metadata as MyHentaiGalleryMetadata | undefined;
    const page = meta?.page ?? 1;
    const url = `${BASE_URL}/${section.id}/${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $("div.comic-inner").each((_, element) => {
      const el = $(element);
      const parsed = this.itemFromElement($, el);
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type:
          section.id === "views"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    const hasNextPage = $("li.next").length > 0;
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
    const meta = metadata as MyHentaiGalleryMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const category = (
      query.metadata as { category?: string } | undefined
    )?.category;

    let url: string;
    if (titleQuery !== "") {
      url = `${BASE_URL}/search/${page}?query=${encodeURIComponent(titleQuery)}`;
    } else if (category) {
      url = `${BASE_URL}/g/category/${encodeURIComponent(category)}/${page}`;
    } else {
      url = `${BASE_URL}/gpage/${page}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("div.comic-inner").each((_, element) => {
      const el = $(element);
      const parsed = this.itemFromElement($, el);
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $("li.next").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find("a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = el.find("h2").first().text().trim();
    const imageUrl = this.imageFromElement(el.find("img").first());
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const info = $("div.comic-header").first();
    const title = info.find("h1").first().text().trim() || this.safeDecode(mangaId);

    const categories = this.tagTexts($, info, "categories");
    const artists = this.tagTexts($, info, "artists");
    const parodies = this.tagTexts($, info, "parodies");
    const groups = this.tagTexts($, info, "groups");

    const thumbnailUrl = this.imageFromElement(
      $(".comic-listing .comic-inner img").first(),
    );

    const tagGroups: TagSection[] = [];
    if (categories.length > 0) {
      tagGroups.push({
        id: "categories",
        title: "Categories",
        tags: categories.map((g) => ({ id: g, title: g })),
      });
    }
    if (artists.length > 0) {
      tagGroups.push({
        id: "artists",
        title: "Artists",
        tags: artists.map((g) => ({ id: g, title: g })),
      });
    }
    if (parodies.length > 0) {
      tagGroups.push({
        id: "parodies",
        title: "Parodies",
        tags: parodies.map((g) => ({ id: g, title: g })),
      });
    }

    const synopsisParts: string[] = [];
    if (groups.length > 0) {
      synopsisParts.push(
        "Groups:\n" + groups.map((g) => `- ${g}`).join("\n"),
      );
    }
    if (parodies.length > 0) {
      synopsisParts.push(
        "Parodies:\n" + parodies.map((p) => `- ${p}`).join("\n"),
      );
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        artist: artists.join(", "),
        synopsis: synopsisParts.join("\n\n"),
        contentRating: ContentRating.MATURE,
        status: "Completed",
        tagGroups,
        shareUrl: url,
      },
    };
  }

  private tagTexts(
    $: CheerioAPI,
    info: Cheerio<AnyNode>,
    label: string,
  ): string[] {
    const results: string[] = [];
    info.find("div").each((_, div) => {
      const d = $(div);
      const own = d
        .contents()
        .filter((_i, node) => node.type === "text")
        .text()
        .toLowerCase();
      if (own.includes(label)) {
        d.find("a").each((_i, a) => {
          const t = $(a).text().trim();
          if (t) results.push(t);
        });
      }
    });
    return results;
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div.comic-thumb img[src]").each((_, element) => {
      const src = $(element).attr("src") || "";
      if (!src) return;
      const full = this.absoluteUrl(src).replace("/thumbnail/", "/original/");
      pages.push(full.replace(/ /g, "%20"));
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

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("data-cfsrc") ||
      img.attr("src") ||
      "";
    return this.absoluteUrl(src).replace(/ /g, "%20");
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

export const MyHentaiGallery = new MyHentaiGalleryExtension();
