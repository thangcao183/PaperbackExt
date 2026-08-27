import {
  BasicRateLimiter,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  ContentRating,
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
import { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";

const BASE_URL = "https://dilib.vn";

interface DilibMetadata {
  page?: number;
}

class DilibInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.8",
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    return data;
  }
}

type DilibImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  DiscoverSectionProviding;

export class DilibExtension implements DilibImplementation {
  requestManager = new DilibInterceptor("main");
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [{ id: "latest", title: "Mới cập nhật", type: DiscoverSectionType.simpleCarousel }];
  }

  async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id !== "latest") return { items: [], metadata: undefined };
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/truyen-tranh/`, method: "GET" });
    const items: DiscoverSectionItem[] = [];
    this.findMangaElements($).each((_, element) => {
      const manga = this.parseMangaElement($, $(element));
      if (manga) items.push({ type: "simpleCarouselItem", ...manga, metadata: undefined });
    });
    return { items, metadata: undefined };
  }

  async getSearchResults(query: SearchQuery<Metadata>, metadata: Metadata | undefined): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as DilibMetadata | undefined)?.page ?? 1;
    const search = (query.title ?? "").trim();
    if (!search) return { items: [], metadata: undefined };
    const suffix = page > 1 ? `&page=${page}` : "";
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/?keyword=${encodeURIComponent(search)}${suffix}`, method: "GET" });
    const items: SearchResultItem[] = [];
    const seen = new Set<string>();
    this.findMangaElements($).each((_, element) => {
      const manga = this.parseMangaElement($, $(element));
      if (!manga || seen.has(manga.mangaId)) return;
      seen.add(manga.mangaId);
      items.push({ ...manga, subtitle: undefined, metadata: undefined });
    });
    const hasNext = $("a[href*='page=']").toArray().some((element) => {
      const href = $(element).attr("href") ?? "";
      return href.includes(`page=${page + 1}`) || $(element).text().trim().toLowerCase() === "next";
    });
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });
    const title = $("h1").first().text().trim() || $("title").text().split("|")[0]?.trim() || mangaId;
    const author = $("p").filter((_, element) => {
      return $(element).find("b").first().text().trim().startsWith("Tác giả");
    }).find("a").first().text().trim();
    const genres: string[] = [];
    $("a[href*='the-loai'], a[href*='genre'], a[href*='category']").each((_, element) => {
      const genre = $(element).text().trim();
      if (genre && genre.length < 50 && !genres.includes(genre)) genres.push(genre);
    });
    const tagGroups: TagSection[] = genres.length ? [{ id: "genres", title: "Thể loại", tags: genres.map((genre) => ({ id: genre.toLowerCase().replace(/\s+/g, "-"), title: genre })) }] : [];
    const body = $("body").text().toLowerCase();
    const status = body.includes("hoàn thành") ? "Completed" : body.includes("đang tiến hành") || body.includes("đang cập nhật") ? "Ongoing" : "Unknown";
    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: this.findCover($),
        synopsis: $(".description, .summary, .detail-content, .story-detail-info, .content").first().text().trim() || "",
        contentRating: ContentRating.EVERYONE,
        author,
        status,
        tagGroups,
        shareUrl: url,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetchCheerio({ url: this.mangaUrl(sourceManga.mangaId), method: "GET" });
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    $("a[href*='-chap-']").each((_, element) => {
      const href = $(element).attr("href") ?? "";
      const chapterId = this.parsePath(href);
      if (!chapterId || seen.has(chapterId)) return;
      seen.add(chapterId);
      const title = $(element).text().trim() || this.chapterTitleFromUrl(href);
      chapters.push({ chapterId, sourceManga, title, volume: 0, chapNum: this.parseChapterNumber(title), publishDate: new Date(0), langCode: "vi" });
    });
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetchCheerio({ url: this.chapterUrl(chapter.chapterId), method: "GET" });
    const pages: string[] = [];
    const seen = new Set<string>();
    $("img").each((_, element) => {
      const source = $(element).attr("data-src") || $(element).attr("data-original") || $(element).attr("data-lazy-src") || $(element).attr("src") || "";
      const url = this.absoluteUrl(source);
      if (url.includes("/img/comic/") && !seen.has(url)) { seen.add(url); pages.push(url); }
    });
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  getMangaShareUrl(mangaId: string): string { return this.mangaUrl(mangaId); }

  private findMangaElements($: CheerioAPI) {
    return $("a").filter((_, element) => {
      const href = $(element).attr("href") ?? "";
      return this.isMangaUrl(href) && $(element).closest(".block_product_thumbnail").length > 0;
    });
  }

  private parseMangaElement($: CheerioAPI, element: Cheerio<AnyNode>) {
    const href = element.attr("href") ?? "";
    const mangaId = this.parsePath(href);
    if (!this.isMangaUrl(href) || !mangaId) return undefined;
    const image = element.find("img").first();
    const imageUrl = this.imageFromElement(image);
    const title = element.attr("title")?.trim() || image.attr("alt")?.trim() || element.find("h2, h3, h4").first().text().trim() || element.text().trim();
    return title ? { mangaId, title, imageUrl } : undefined;
  }

  private isMangaUrl(href: string): boolean {
    const clean = href.replace(BASE_URL, "").split(/[?#]/)[0];
    return !!clean && !clean.includes("-chap-") && !clean.startsWith("/truyen-tranh/") && /\/[^/]+-\d+\.html$/.test(clean);
  }

  private mangaUrl(id: string): string { return this.absoluteUrl(this.safeDecode(id)); }
  private chapterUrl(id: string): string { return this.absoluteUrl(this.safeDecode(id)); }
  private parsePath(href: string): string { return href.replace(BASE_URL, "").replace(/[?#].*$/, "").replace(/^\/+/, ""); }
  private safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
  private parseChapterNumber(title: string): number { const match = title.match(/(?:chap(?:ter)?|chương)\s*[-:]?\s*(\d+(?:\.\d+)?)/i) || title.match(/(\d+(?:\.\d+)?)/); return match?.[1] ? Number.parseFloat(match[1]) : 0; }
  private chapterTitleFromUrl(href: string): string { return `Chap ${href.match(/-chap-([\d.]+)/i)?.[1] ?? ""}`.trim(); }

  private findCover($: CheerioAPI): string {
    let cover = "";
    $("img").each((_, element) => {
      const image = $(element);
      const url = this.imageFromElement(image);
      if (!cover && url && !url.includes("/logo") && !url.includes("avatar") && (image.attr("alt") || url.includes("/img/news/"))) cover = url;
    });
    return cover;
  }

  private imageFromElement(image: Cheerio<AnyNode>): string {
    return this.absoluteUrl(image.attr("data-src") || image.attr("data-original") || image.attr("data-lazy-src") || image.attr("src") || "");
  }

  private absoluteUrl(source: string): string {
    const value = source.trim();
    if (!value) return "";
    if (value.startsWith("//")) return `https:${value}`;
    if (value.startsWith("http")) return value;
    return `${BASE_URL}/${value.replace(/^\/+/, "")}`;
  }

  private async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Không tìm thấy nội dung");
    if (response.status < 200 || response.status >= 400) throw new Error(`Dilib HTTP ${response.status}`);
    return cheerio.load(htmlparser2.parseDocument(Application.arrayBufferToUTF8String(data)));
  }
}

export const Dilib = new DilibExtension();
