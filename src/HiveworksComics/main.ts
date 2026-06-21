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

const BASE_URL = "https://hiveworkscomics.com";

const POPULAR_MANGA_SELECTOR = "div.comicblock";
const SEARCH_MANGA_SELECTOR = "div.comicblock, div.originalsblock";
const CHAPTER_LIST_SELECTOR = "select[name=comic] option";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const GENRES: { id: string; title: string }[] = [
  { id: "action/adventure", title: "Action/Adventure" },
  { id: "animated", title: "Animated" },
  { id: "autobio", title: "Autobio" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "dystopian", title: "Dystopian" },
  { id: "fairytale", title: "Fairytale" },
  { id: "fantasy", title: "Fantasy" },
  { id: "finished", title: "Finished" },
  { id: "historical-fiction", title: "Historical Fiction" },
  { id: "horror", title: "Horror" },
  { id: "lgbt", title: "LGBT" },
  { id: "mystery", title: "Mystery" },
  { id: "romance", title: "Romance" },
  { id: "sci-fi", title: "Science Fiction" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "steampunk", title: "Steampunk" },
  { id: "superhero", title: "Superhero" },
  { id: "urban-fantasy", title: "Urban Fantasy" },
];

interface HiveworksSearchMeta {
  genre?: string;
  list?: string;
}

class HiveworksComicsInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
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

type HiveworksComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class HiveworksComicsExtension
  implements HiveworksComicsImplementation
{
  requestManager = new HiveworksComicsInterceptor("main");
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
        title: "Featured Comics",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Updated Today",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "originals",
        title: "Original Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "kids",
        title: "Kids Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "completed",
        title: "Completed Comics",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "hiatus",
        title: "On Hiatus Comics",
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
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const items: DiscoverSectionItem[] = GENRES.map((g) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { searchMeta: { genre: g.id } },
        },
        name: g.title,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const url = this.discoverUrl(section.id);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    if (section.id === "originals") {
      $("div.originalsblock").each((_, element) => {
        const parsed = this.originalItemFromElement($, $(element));
        if (!parsed) return;
        if (seen.has(parsed.mangaId)) return;
        seen.add(parsed.mangaId);
        items.push({
          type: "simpleCarouselItem",
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          metadata: undefined,
        });
      });
      return { items, metadata: undefined };
    }

    const cardType =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";

    $(POPULAR_MANGA_SELECTOR).each((_, element) => {
      const parsed = this.mangaItemFromElement($, $(element));
      if (!parsed) return;
      if (this.isUnsupported(parsed.mangaId)) return;
      if (seen.has(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      items.push({
        type: cardType,
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        metadata: undefined,
      });
    });

    return { items, metadata: undefined };
  }

  private discoverUrl(sectionId: string): string {
    switch (sectionId) {
      case "latest": {
        const day = WEEKDAYS[new Date().getDay()];
        return `${BASE_URL}/home/update-day/${day}`;
      }
      case "originals":
        return `${BASE_URL}/originals`;
      case "kids":
        return `${BASE_URL}/kids`;
      case "completed":
        return `${BASE_URL}/completed`;
      case "hiatus":
        return `${BASE_URL}/hiatus`;
      default:
        return BASE_URL;
    }
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();
    const searchMeta = (
      query.metadata as { searchMeta?: HiveworksSearchMeta } | undefined
    )?.searchMeta;

    let url = BASE_URL;
    let mode: "local" | "originals" | "list" = "list";

    if (searchMeta?.list) {
      url = `${BASE_URL}/${searchMeta.list}`;
      mode = searchMeta.list === "originals" ? "originals" : "list";
    } else if (searchMeta?.genre) {
      url = `${BASE_URL}/home/genre/${searchMeta.genre}`;
      mode = "list";
    } else if (titleQuery !== "") {
      url = BASE_URL;
      mode = "local";
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    if (mode === "originals") {
      $("div.originalsblock").each((_, element) => {
        const parsed = this.originalItemFromElement($, $(element));
        if (!parsed || seen.has(parsed.mangaId)) return;
        seen.add(parsed.mangaId);
        results.push({
          mangaId: parsed.mangaId,
          imageUrl: parsed.imageUrl,
          title: parsed.title,
          subtitle: undefined,
          metadata: undefined,
        });
      });
      return { items: results, metadata: undefined };
    }

    const lowered = titleQuery.toLowerCase();
    $(SEARCH_MANGA_SELECTOR).each((_, element) => {
      const el = $(element);
      if (mode === "local" && !el.text().toLowerCase().includes(lowered)) {
        return;
      }
      const parsed = this.mangaItemFromElement($, el);
      if (!parsed || seen.has(parsed.mangaId)) return;
      if (this.isUnsupported(parsed.mangaId)) return;
      seen.add(parsed.mangaId);
      results.push({
        mangaId: parsed.mangaId,
        imageUrl: parsed.imageUrl,
        title: parsed.title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    return { items: results, metadata: undefined };
  }

  private mangaItemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const href = el.find("a.comiclink").first().attr("href") || "";
    if (!href) return undefined;
    const abs = this.absoluteUrl(href);
    const mangaId = this.toSafeId(abs);
    const title = el.find("h1").first().text().trim();
    const imageUrl = this.imageFromElement(el.find("img").first());
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  private originalItemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const href = el.find("a").first().attr("href") || "";
    if (!href) return undefined;
    const abs = this.absoluteUrl(href);
    const mangaId = this.toSafeId(abs);
    const header = el.find("div.header").text();
    const title = header.split(/by/i)[0].trim();
    const imgs = el.find("img");
    const img = imgs.length > 1 ? imgs.eq(1) : imgs.first();
    const imageUrl = this.imageFromElement(img);
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  private isUnsupported(mangaId: string): boolean {
    const url = this.safeDecode(mangaId);
    return (
      url.includes("sparklermonthly.com") ||
      url.includes("explosm.net") ||
      url.includes("smbc-comics")
    );
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const targetUrl = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url: BASE_URL, method: "GET" });

    let found:
      | {
          title: string;
          imageUrl: string;
          author: string;
          synopsis: string;
          genre: string;
        }
      | undefined;

    $(POPULAR_MANGA_SELECTOR).each((_, element) => {
      if (found) return;
      const el = $(element);
      const href = el.find("a.comiclink").first().attr("href") || "";
      if (!href) return;
      if (this.absoluteUrl(href) !== targetUrl) return;
      found = {
        title: el.find("h1").first().text().trim(),
        imageUrl: this.imageFromElement(el.find("img").first()),
        author: el.find("h2").first().text().replace(/^by/i, "").trim(),
        synopsis: el.find("div.description").first().text().trim(),
        genre: el.find("div.comicrating").first().text().trim(),
      };
    });

    const title = found?.title || this.safeDecode(mangaId);
    const author = found?.author || "";
    const genre = found?.genre || "";

    const tagGroups: TagSection[] = [];
    if (genre) {
      tagGroups.push({
        id: "rating",
        title: "Rating",
        tags: [{ id: genre.toLowerCase().replace(/\s+/g, "-"), title: genre }],
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: found?.imageUrl || "",
        author: author || undefined,
        artist: author || undefined,
        synopsis: found?.synopsis || "",
        contentRating: ContentRating.EVERYONE,
        status: "Ongoing",
        tagGroups,
        shareUrl: targetUrl,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaUrl = this.mangaUrl(sourceManga.mangaId);
    const listUrl = this.chapterListRequestUrl(mangaUrl);
    const $ = await this.fetchCheerio({ url: listUrl, method: "GET" });

    if (mangaUrl.includes("witchycomic")) {
      return this.witchyChapters($, sourceManga);
    }
    if (mangaUrl.includes("sssscomic")) {
      return this.ssssChapters($, sourceManga, listUrl);
    }
    if (mangaUrl.includes("awkwardzombie")) {
      return this.awkwardzombieChapters($, sourceManga);
    }

    const scriptHtml = $("div script").first().html() || "";
    let chapterBase = "";
    if (scriptHtml.includes("href='")) {
      chapterBase = scriptHtml.split("href='")[1]?.split("'")[0] || "";
    }

    const options = $(CHAPTER_LIST_SELECTOR).toArray();
    const entries: {
      chapterId: string;
      name: string;
      publishDate: Date;
    }[] = [];

    for (let i = 1; i < options.length; i++) {
      const el = $(options[i]);
      const text = el.text();
      const name = text.includes("-")
        ? text.substring(text.indexOf("-") + 1).trim()
        : text.trim();
      const value = el.attr("value") || "";
      const chapterUrl = this.absoluteUrl(`${chapterBase}${value}`);
      const dateText = text.includes("-")
        ? text.substring(0, text.indexOf("-")).trim()
        : "";
      entries.push({
        chapterId: this.toSafeId(chapterUrl),
        name,
        publishDate: this.parseDate(dateText),
      });
    }

    let filtered = entries;
    if (mangaUrl.includes("checkpleasecomic")) {
      filtered = entries.filter(
        (e) => e.name.endsWith("01") || e.name.endsWith(" 1"),
      );
    }

    filtered.reverse();
    return filtered.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: filtered.length - index,
      publishDate: entry.publishDate,
      langCode: "🇬🇧",
    }));
  }

  private chapterListRequestUrl(mangaUrl: string): string {
    const trimmed = mangaUrl.replace(/\/+$/, "");
    if (trimmed.includes("sssscomic")) {
      const sep = trimmed.includes("?") ? "&" : "?";
      return `${trimmed}${sep}id=archive`;
    }
    if (trimmed.includes("awkwardzombie")) {
      return `${trimmed}/awkward-zombie/archive`;
    }
    return `${trimmed}/comic/archive`;
  }

  private awkwardzombieChapters(
    $: CheerioAPI,
    sourceManga: SourceManga,
  ): Chapter[] {
    const chapters: Chapter[] = [];
    $("div.archive-line").each((_, element) => {
      const el = $(element);
      const dateText = el.find(".archive-date").text();
      const chapterNumberText = dateText
        .split("#")[1]
        ?.split(",")[0]
        ?.trim();
      const chapterNumber = chapterNumberText
        ? parseFloat(chapterNumberText)
        : 0;
      const title = el.find("div.archive-title").text().trim();
      const game = el.find(".archive-game").text().trim();
      const href = el.find("a").first().attr("href") || "";
      if (!href) return;
      const chapterUrl = this.absoluteUrl(href);
      const datePart = dateText.includes(", ")
        ? dateText.substring(dateText.indexOf(", ") + 2).trim()
        : "";
      chapters.push({
        chapterId: this.toSafeId(chapterUrl),
        sourceManga,
        title: `#${chapterNumberText ?? ""} ${title} (${game})`.trim(),
        volume: 0,
        chapNum: chapterNumber,
        publishDate: this.parseAwkwardDate(datePart),
        langCode: "🇬🇧",
      });
    });
    return chapters;
  }

  private witchyChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const elements = $(".cc-storyline-pagethumb a").toArray();
    const chapters: Chapter[] = [];
    for (let i = 1; i < elements.length; i++) {
      const href = $(elements[i]).attr("href") || "";
      if (!href.includes("page-")) continue;
      const chapterUrl = this.absoluteUrl(href);
      chapters.push({
        chapterId: this.toSafeId(chapterUrl),
        sourceManga,
        title: `Page ${i}`,
        volume: 0,
        chapNum: i,
        publishDate: new Date(0),
        langCode: "🇬🇧",
      });
    }
    chapters.reverse();
    return chapters;
  }

  private ssssChapters(
    $: CheerioAPI,
    sourceManga: SourceManga,
    listUrl: string,
  ): Chapter[] {
    const advCount = $("div[id^=adv]").length;
    const chapters: Chapter[] = [];
    for (let i = 1; i < advCount + 1; i++) {
      $(`#adv${i}Div a`).each((_, element) => {
        const el = $(element);
        const href = el.attr("href") || "";
        if (!href) return;
        const chapterUrl = this.resolveRelative(listUrl, `../../${href}`);
        if (!chapterUrl.includes("page")) return;
        chapters.push({
          chapterId: this.toSafeId(chapterUrl),
          sourceManga,
          title: `Adventure ${i} - Page ${el.text().trim()}`,
          volume: 0,
          chapNum: 0,
          publishDate: new Date(0),
          langCode: "🇬🇧",
        });
      });
    }
    chapters.reverse();
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = this.chapterUrl(chapter.chapterId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const pages: string[] = [];
    $("div#cc-comicbody img").each((_, element) => {
      const src = $(element).attr("src") || "";
      if (src) pages.push(this.absoluteUrl(src));
    });

    if (url.includes("sssscomic")) {
      const urlPath = $("img.comicnormal").first().attr("src") || "";
      if (urlPath) {
        pages.push(this.resolveRelative(url, `../../${urlPath}`));
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
    return this.absoluteUrl(src);
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private resolveRelative(base: string, relative: string): string {
    try {
      return new URL(relative, base).toString();
    } catch {
      return this.absoluteUrl(relative);
    }
  }

  private parseDate(text: string): Date {
    const t = (text || "").trim();
    if (!t) return new Date(0);
    const parsed = Date.parse(t);
    if (!isNaN(parsed)) return new Date(parsed);
    return new Date(0);
  }

  private parseAwkwardDate(text: string): Date {
    // Format MM-dd-yy
    const m = (text || "").trim().match(/(\d{1,2})-(\d{1,2})-(\d{2})/);
    if (!m) return new Date(0);
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const year = 2000 + parseInt(m[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? new Date(0) : d;
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

export const HiveworksComics = new HiveworksComicsExtension();
