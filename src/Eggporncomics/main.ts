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

const BASE_URL = "https://eggporncomics.com";

interface EggporncomicsMetadata {
  page?: number;
}

// Category filter values from upstream Filters.kt (label -> "id/slug")
const CATEGORY_LIST: { label: string; value: string }[] = [
  { label: "3d comics", value: "7/3d-comics" },
  { label: "8muses", value: "18/8muses" },
  { label: "Anime", value: "1/anime" },
  { label: "Cartoon", value: "2/cartoon" },
  { label: "Dickgirls & Shemale", value: "6/dickgirls-shemale" },
  { label: "Furry", value: "4/furry" },
  { label: "Games comics", value: "3/games-comics" },
  { label: "Hentai manga", value: "10/hentai-manga" },
  { label: "Interracial", value: "14/interracial" },
  { label: "Milf", value: "11/milf" },
  { label: "Mindcontrol", value: "15/mindcontrol" },
  { label: "Porn Comix", value: "16/porn-comix" },
  { label: "Western", value: "12/western" },
  { label: "Yaoi/Gay", value: "8/yaoigay" },
  { label: "Yuri and Lesbian", value: "9/yuri-and-lesbian" },
];

// Comics tag filter values from upstream Filters.kt (label -> "id/slug")
const COMICS_LIST: { label: string; value: string }[] = [
  { label: "3d", value: "85/3d" },
  { label: "Adventure Time", value: "2950/adventure-time" },
  { label: "Anal", value: "13/anal" },
  { label: "Ben 10", value: "641/ben10" },
  { label: "Big boobs", value: "3025/big-boobs" },
  { label: "Big breasts", value: "6/big-breasts" },
  { label: "Big cock", value: "312/big-cock" },
  { label: "Bigass", value: "604/big-ass-porn-comics-new" },
  { label: "Black cock", value: "2990/black-cock" },
  { label: "Blowjob", value: "7/blowjob" },
  { label: "Bondage", value: "24/bondage" },
  { label: "Breast expansion hentai", value: "102/breast-expansion-new" },
  { label: "Cumshot", value: "427/cumshot" },
  { label: "Dark skin", value: "29/dark-skin" },
  { label: "Dofantasy", value: "1096/dofantasy" },
  { label: "Double penetration", value: "87/double-penetration" },
  { label: "Doujin moe", value: "3028/doujin-moe" },
  { label: "Erotic", value: "602/erotic" },
  { label: "Fairy tail porn", value: "3036/fairy-tail" },
  { label: "Fakku", value: "1712/Fakku-Comics-new" },
  { label: "Family Guy porn", value: "774/family-guy" },
  { label: "Fansadox", value: "1129/fansadox-collection" },
  { label: "Feminization", value: "385/feminization" },
  { label: "Forced", value: "315/forced" },
  { label: "Full color", value: "349/full-color" },
  { label: "Furry", value: "19/furry" },
  { label: "Futanari", value: "2994/futanari" },
  { label: "Group", value: "58/group" },
  { label: "Hardcore", value: "304/hardcore" },
  { label: "Harry Potter porn", value: "338/harry-potter" },
  { label: "Hentai", value: "321/hentai" },
  { label: "Incest", value: "3007/incest" },
  { label: "Incognitymous", value: "545/incognitymous" },
  { label: "Interracical", value: "608/interracical" },
  { label: "Jab Comix", value: "1695/JAB-Comics-NEW-2" },
  { label: "Kaos comics", value: "467/kaos" },
  { label: "Kim Possible porn", value: "788/kim-possible" },
  { label: "Lesbian", value: "313/lesbian" },
  { label: "Locofuria", value: "343/locofuria" },
  { label: "Milf", value: "48/milf" },
  { label: "Milftoon", value: "1678/milftoon-comics" },
  { label: "Muscle", value: "2/muscle" },
  { label: "Nakadashi", value: "10/nakadashi" },
  { label: "PalComix", value: "373/palcomix" },
  { label: "Pokemon hentai", value: "657/pokemon" },
  { label: "Shadbase", value: "1717/shadbase-comics" },
  { label: "Shemale", value: "126/shemale" },
  { label: "Slut", value: "301/slut" },
  { label: "Sparrow hentai", value: "3035/sparrow-hentai" },
  { label: "Star Wars hentai", value: "1344/star-wars" },
  { label: "Stockings", value: "51/stockings" },
  { label: "Superheroine Central", value: "615/superheroine-central" },
  { label: "The Cummoner", value: "3034/the-cummoner" },
  { label: "The Rock Cocks", value: "3031/the-rock-cocks" },
  { label: "ZZZ Comics", value: "1718/zzz-comics" },
];

class EggporncomicsInterceptor extends PaperbackInterceptor {
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

type EggporncomicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class EggporncomicsExtension implements EggporncomicsImplementation {
  requestManager = new EggporncomicsInterceptor("main");
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
        id: "popular",
        title: "Popular (Anime Comics)",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Latest Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "categories",
        title: "Categories",
        type: DiscoverSectionType.genres,
      },
      {
        id: "comics_tags",
        title: "Comics Tags",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "categories") {
      const items: DiscoverSectionItem[] = CATEGORY_LIST.map((c) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { categorySlug: c.value },
        },
        name: c.label,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === "comics_tags") {
      const items: DiscoverSectionItem[] = COMICS_LIST.map((c) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { comicsSlug: c.value },
        },
        name: c.label,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as EggporncomicsMetadata | undefined;
    const page = meta?.page ?? 1;
    const url =
      section.id === "popular"
        ? `${BASE_URL}/category/1/anime-comics?page=${page}`
        : `${BASE_URL}/latest-comics?page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    for (const parsed of this.parseMangaList($)) {
      if (seen.has(parsed.mangaId)) continue;
      seen.add(parsed.mangaId);
      items.push({
        type:
          section.id === "popular"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    }

    const hasNextPage = this.hasNextPage($);
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as EggporncomicsMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const filterMeta = query.metadata as
      | { categorySlug?: string; comicsSlug?: string }
      | undefined;

    let url: string;
    if (titleQuery !== "") {
      // upstream replaces whitespace and apostrophes with "-"
      const slug = titleQuery.replace(/[\s']/g, "-");
      url = `${BASE_URL}/search/${slug}?page=${page}`;
    } else {
      const category = filterMeta?.categorySlug;
      const comics = filterMeta?.comicsSlug;
      if (category && comics) {
        url = `${BASE_URL}/category-tag/${category}/${comics}?page=${page}`;
      } else if (category) {
        url = `${BASE_URL}/category/${category}?page=${page}`;
      } else if (comics) {
        url = `${BASE_URL}/comics-tag/${comics}?page=${page}`;
      } else {
        // default to popular anime-comics category when nothing supplied
        url = `${BASE_URL}/category/1/anime-comics?page=${page}`;
      }
    }

    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    // combining category + comics with no results yields a 404; treat as empty
    if (response.status === 404) {
      return { items: [], metadata: undefined };
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const $ = cheerio.load(htmlparser2.parseDocument(htmlStr));

    const results: SearchResultItem[] = [];
    for (const parsed of this.parseMangaList($)) {
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private parseMangaList(
    $: CheerioAPI,
  ): { mangaId: string; imageUrl: string; title: string }[] {
    const out: { mangaId: string; imageUrl: string; title: string }[] = [];
    $("div.preview:has(div.name)").each((_, element) => {
      const a = $(element).find("a:has(img)").first();
      const href = a.attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId) return;
      const title = a.text().trim();
      const imageUrl = this.imageFromElement(a.find("img").first());
      out.push({ mangaId, imageUrl, title });
    });
    return out;
  }

  private hasNextPage($: CheerioAPI): boolean {
    return $("ul.ne-pe li.next:not(.disabled)").length > 0;
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const thumbnailUrl = this.toFullSizeImage(
      this.imageFromElement($("div.grid div.image img").first()),
    );

    // description: each "div.links ul" -> "<span label>: <a-texts...>"
    const descParts: string[] = [];
    const tagGroups: TagSection[] = [];
    $("div.links ul").each((_, ul) => {
      const el = $(ul);
      const label = el
        .find("span")
        .first()
        .text()
        .replace(/:.*/, "")
        .trim();
      const values = el
        .find("a")
        .map((_i, a) => $(a).text().trim())
        .get()
        .filter((t) => t.length > 0);
      if (values.length === 0) return;
      descParts.push(`${label}: ${values.join(", ")}`);
      tagGroups.push({
        id: label.toLowerCase().replace(/\s+/g, "-") || `group-${tagGroups.length}`,
        title: label || "Tags",
        tags: values.map((v) => ({
          id: v.toLowerCase().replace(/\s+/g, "-"),
          title: v,
        })),
      });
    });

    const title =
      $("h1").first().text().trim() ||
      $("div.info h1, div.title").first().text().trim() ||
      this.safeDecode(mangaId);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        synopsis: descParts.join("\n"),
        contentRating: ContentRating.MATURE,
        status: "Completed",
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

    const daysText = $("div.info > div.meta li:contains(days ago)")
      .first()
      .text()
      .trim();
    let publishDate = new Date(0);
    const daysMatch = daysText.match(/(\d+)/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      const d = new Date();
      d.setDate(d.getDate() - days);
      publishDate = d;
    }

    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title: "Chapter",
        volume: 0,
        chapNum: 1,
        publishDate,
        langCode: "🇬🇧",
      },
    ];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div.grid div.image img").each((_, element) => {
      const src = this.imageFromElement($(element));
      const full = this.toFullSizeImage(src);
      if (full) pages.push(full);
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

  private toFullSizeImage(src: string): string {
    return (src || "").replace("thumb300_", "");
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

export const Eggporncomics = new EggporncomicsExtension();
