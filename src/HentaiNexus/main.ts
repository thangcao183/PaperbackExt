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

const BASE_URL = "https://hentainexus.com";
const POPULAR_NOW_PATH = "/explore/hot";

interface HentaiNexusMetadata {
  page?: number;
}

class HentaiNexusInterceptor extends PaperbackInterceptor {
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

type HentaiNexusImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class HentaiNexusExtension implements HentaiNexusImplementation {
  requestManager = new HentaiNexusInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
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
        title: "Popular Now",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as HentaiNexusMetadata | undefined;
    const page = meta?.page ?? 1;

    let url: string;
    if (section.id === "popular") {
      url = `${BASE_URL}${POPULAR_NOW_PATH}`;
    } else {
      url = page > 1 ? `${BASE_URL}/page/${page}` : BASE_URL;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const { items: parsed, hasNextPage } = this.parseMangaList(
      $,
      section.id === "popular",
    );

    const items: DiscoverSectionItem[] = parsed.map((p) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: p.mangaId,
      imageUrl: p.imageUrl,
      title: p.title,
      metadata: undefined,
    }));

    // Popular Now (explore/hot) has no real pagination.
    const nextMeta =
      section.id !== "popular" && hasNextPage ? { page: page + 1 } : undefined;
    return { items, metadata: nextMeta };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as HentaiNexusMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (page > 1) {
      url = `${BASE_URL}/page/${page}?q=${encodeURIComponent(titleQuery)}`;
    } else {
      url = `${BASE_URL}/?q=${encodeURIComponent(titleQuery)}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const { items: parsed, hasNextPage } = this.parseMangaList($, false);

    const results: SearchResultItem[] = parsed.map((p) => ({
      mangaId: p.mangaId,
      imageUrl: p.imageUrl,
      title: p.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private parseMangaList(
    $: CheerioAPI,
    isPopularNow: boolean,
  ): {
    items: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  } {
    const items: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();

    $(".container .column").each((_, element) => {
      const el = $(element);
      const href = el.find("a").first().attr("href") || "";
      if (!href) return;
      const mangaId = this.parsePath(href);
      if (!mangaId || seen.has(mangaId)) return;
      const title = el.find(".card-header-title").first().text().trim();
      if (!title) return;
      const imageUrl = this.imageFromElement(
        el.find(".card-image img").first(),
      );
      seen.add(mangaId);
      items.push({ mangaId, imageUrl, title });
    });

    const hasNextPage =
      isPopularNow || $("a.pagination-next[href]").length > 0;
    return { items, hasNextPage };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const table = $(".view-page-details").first();

    const title =
      $("h1.title").first().text().trim() || this.safeDecode(mangaId);

    const artists = table
      .find("td.viewcolumn:contains(Artist) + td a")
      .map((_, el) => $(el).text().trim())
      .get();
    const authors = table
      .find("td.viewcolumn:contains(Author) + td a")
      .map((_, el) => $(el).text().trim())
      .get();
    const authorList = [...authors, ...artists].filter(
      (v, i, arr) => v.length > 0 && arr.indexOf(v) === i,
    );
    const author = authorList.length > 0 ? authorList.join(", ") : undefined;

    const descParts: string[] = [];
    for (const key of [
      "Circle",
      "Event",
      "Magazine",
      "Parody",
      "Publisher",
      "Pages",
      "Favorites",
    ]) {
      const cell = table
        .find(`td.viewcolumn:contains(${key}) + td`)
        .first();
      if (cell.length === 0) continue;
      let value = cell
        .contents()
        .filter((_, n) => n.type === "text")
        .text()
        .trim();
      if (!value) value = cell.find("a").first().text().trim();
      if (value) descParts.push(`${key}: ${value}`);
    }
    const descriptionBody = table
      .find("td.viewcolumn:contains(Description) + td")
      .first()
      .text()
      .trim();
    const synopsis = [
      descParts.join("\n"),
      descriptionBody ? `\n${descriptionBody}` : "",
    ]
      .join("")
      .trim();

    const tagCountRegex = /\s*\([\d,]+\)$/;
    const genres = table
      .find("span.tag a")
      .map((_, el) => $(el).text().trim().replace(tagCountRegex, "").trim())
      .get()
      .filter((g) => g.length > 0);

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: genres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    const thumbnailUrl = this.imageFromElement(
      $("figure.image img").first(),
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author,
        artist: undefined,
        synopsis,
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

    const table = $(".view-page-details").first();
    const dateStr = table
      .find("td.viewcolumn:contains(Published) + td")
      .first()
      .text()
      .trim();
    const publishDate = this.parseDate(dateStr);

    const id = this.idFromMangaId(sourceManga.mangaId);
    const chapterId = this.parsePath(`/read/${id}`);

    return [
      {
        chapterId,
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

    let scriptData = "";
    $("script").each((_, el) => {
      if (scriptData) return;
      const content = $(el).contents().text();
      if (content.includes("initReader")) {
        scriptData = content;
      }
    });

    if (!scriptData) {
      throw new Error(
        "Could not find initReader script; the page structure may have changed",
      );
    }

    const encoded = scriptData
      .split('initReader("')[1]
      ?.split('",')[0];
    if (!encoded) {
      throw new Error("Could not extract reader payload");
    }

    const data = this.decryptData(encoded);
    const parsed = JSON.parse(data) as unknown;

    const pages: string[] = [];
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (
          entry &&
          typeof entry === "object" &&
          (entry as Record<string, unknown>).type === "image"
        ) {
          const record = entry as Record<string, unknown>;
          const image =
            typeof record.image === "string" && record.image
              ? record.image
              : typeof record.image_fallback === "string"
                ? record.image_fallback
                : "";
          if (image) {
            pages.push(this.absoluteUrl(image));
          }
        }
      }
    }

    if (pages.length === 0) {
      throw new Error(
        "No pages found for this chapter; the reader payload may have changed",
      );
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
  // Reader payload decryption (ported from upstream Utils.decryptData)
  // ----------------------------------------------------------------

  private decryptData(encoded: string): string {
    const data = this.base64ToBytes(encoded);

    const hostname = "hentainexus.com";
    for (let i = 0; i < hostname.length; i++) {
      data[i] = data[i] ^ hostname.charCodeAt(i);
    }

    const keyStream: number[] = [];
    for (let i = 0; i < 64; i++) keyStream.push(data[i] & 0xff);
    const ciphertext: number[] = [];
    for (let i = 64; i < data.length; i++) ciphertext.push(data[i] & 0xff);

    const digest: number[] = [];
    for (let i = 0; i <= 255; i++) digest.push(i);

    const primeNumbers = [2, 3, 5, 7, 11, 13, 17, 19];
    const PRIME_IDX_XOR_MASK = 12;

    let primeIdx = 0;
    for (let i = 0; i < 64; i++) {
      primeIdx = primeIdx ^ keyStream[i];
      for (let j = 0; j < 8; j++) {
        if ((primeIdx & 1) !== 0) {
          primeIdx = (primeIdx >>> 1) ^ PRIME_IDX_XOR_MASK;
        } else {
          primeIdx = primeIdx >>> 1;
        }
      }
    }
    primeIdx = primeIdx & 7;

    let temp: number;
    let key = 0;
    for (let i = 0; i <= 255; i++) {
      key = (key + digest[i] + keyStream[i % 64]) % 256;
      temp = digest[i];
      digest[i] = digest[key];
      digest[key] = temp;
    }

    const q = primeNumbers[primeIdx];
    let k = 0;
    let n = 0;
    let p = 0;
    let xorKey = 0;
    let result = "";
    for (let i = 0; i < ciphertext.length; i++) {
      k = (k + q) % 256;
      n = (p + digest[(n + digest[k]) % 256]) % 256;
      p = (p + k + digest[k]) % 256;

      temp = digest[k];
      digest[k] = digest[n];
      digest[n] = temp;

      xorKey =
        digest[(n + digest[(k + digest[(xorKey + p) % 256]) % 256]) % 256];
      result += String.fromCharCode(ciphertext[i] ^ xorKey);
    }
    return result;
  }

  private base64ToBytes(b64: string): number[] {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (c === "=") break;
      const idx = chars.indexOf(c);
      if (idx === -1) continue;
      buffer = (buffer << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >>> bits) & 0xff);
      }
    }
    return bytes;
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

  private idFromMangaId(mangaId: string): string {
    const slug = this.safeDecode(mangaId).replace(/[?#].*$/, "");
    const parts = slug.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || "";
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

  private parseDate(dateStr: string): Date {
    const s = (dateStr || "").trim();
    if (!s) return new Date(0);
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t);
    return new Date(0);
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

export const HentaiNexus = new HentaiNexusExtension();
