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

const BASE_URL = "https://xoxocomic.com";

interface XOXOComicsMetadata {
  page?: number;
}

type XOXOComicsSearchMeta = {
  genre?: string;
};

class XOXOComicsInterceptor extends PaperbackInterceptor {
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
    if (isCloudflareChallenge(response, data)) {
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

function normalizeHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}

function isCloudflareChallenge(response: Response, data: ArrayBuffer): boolean {
  const headers = response.headers as Record<string, string> | undefined;

  // Newer managed / Turnstile challenges expose this header directly.
  if (normalizeHeader(headers, "cf-mitigated") === "challenge") {
    return true;
  }

  // Classic "Just a moment..." JS interstitial: HTTP 403/503 served by
  // Cloudflare with no cf-mitigated header. Confirm via the server header
  // and challenge markers in the body to avoid false positives on ordinary
  // 403/503 pages.
  const status = response.status ?? 0;
  if (status !== 403 && status !== 503) {
    return false;
  }

  const server = normalizeHeader(headers, "server")?.toLowerCase() ?? "";
  if (!server.includes("cloudflare")) {
    return false;
  }

  let body: string;
  try {
    body = Application.arrayBufferToUTF8String(data);
  } catch {
    return false;
  }

  return (
    body.includes("challenge-platform") ||
    body.includes("cf-browser-verification") ||
    body.includes("_cf_chl_opt") ||
    body.includes("Just a moment")
  );
}

function toBase64String(value: string | ArrayBuffer): string {
  if (typeof value === "string") return value;
  return Application.arrayBufferToUTF8String(value);
}

// Sniff the image type from the leading magic bytes, falling back to the file
// extension. Returns undefined when the bytes are clearly not an image (e.g. an
// HTML error/challenge page), so callers can avoid wrapping junk in a data URI.
function detectImageMime(
  data: ArrayBuffer,
  url: string,
): string | undefined {
  const bytes = new Uint8Array(data);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  // Reject obvious non-image payloads (HTML pages start with '<').
  if (bytes.length >= 1 && (bytes[0] === 0x3c || bytes[0] === 0x7b)) {
    return undefined;
  }

  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";

  // Unknown but non-HTML: assume JPEG (the site's default) rather than dropping.
  return "image/jpeg";
}

type XOXOComicsImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class XOXOComicsExtension implements XOXOComicsImplementation {
  requestManager = new XOXOComicsInterceptor("main");
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
        title: "Hot Comics",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
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
      return this.getGenresSection();
    }

    const meta = metadata as XOXOComicsMetadata | undefined;
    const page = meta?.page ?? 1;

    let url: string;
    let selector: string;
    let latest = false;
    if (section.id === "latest") {
      url = `${BASE_URL}/comic-update?page=${page}`;
      selector = "li.row";
      latest = true;
    } else {
      url = `${BASE_URL}/hot-comic${page > 1 ? `?page=${page}` : ""}`;
      selector = "div.items div.item";
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(selector).each((_, element) => {
      const el = $(element);
      const parsed = latest
        ? this.latestFromElement($, el)
        : this.itemFromElement($, el);
      if (!parsed) return;
      if (seen.has(parsed.mangaId)) return;
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
    });

    const hasNextPage = this.hasNextPage($);
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async getGenresSection(): Promise<
    PagedResults<DiscoverSectionItem>
  > {
    const $ = await this.fetchCheerio({
      url: `${BASE_URL}/comic-list`,
      method: "GET",
    });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    $(".genres h2:contains(Genres) + ul.nav li a").each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      const name = el.text().trim();
      if (!href || !name) return;
      const genre = href.replace(/\/+$/, "").split("/").pop() || "";
      if (!genre || seen.has(genre)) return;
      seen.add(genre);
      items.push({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre } as XOXOComicsSearchMeta,
        },
        name,
        metadata: { genre } as XOXOComicsSearchMeta,
      });
    });

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as XOXOComicsMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const searchMeta = query.metadata as XOXOComicsSearchMeta | undefined;
    const genre = searchMeta?.genre;

    let url: string;
    if (titleQuery !== "" || !genre) {
      // Search won't work together with filter
      url = `${BASE_URL}/search-comic?keyword=${encodeURIComponent(
        titleQuery,
      )}&page=${page}`;
    } else {
      url = `${BASE_URL}/${genre}?page=${page}&sort=0`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    $("div.items div.item").each((_, element) => {
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

    const hasNextPage = this.hasNextPage($);
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private hasNextPage($: CheerioAPI): boolean {
    return $("a.next-page, a[rel=next]").length > 0;
  }

  private itemFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find("h3 a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = link.text().trim();
    const imageUrl = this.imageFromElement(el.find("div.image img").first());
    if (!title) return undefined;
    return { mangaId, imageUrl, title };
  }

  private latestFromElement(
    $: CheerioAPI,
    el: Cheerio<AnyNode>,
  ): { mangaId: string; imageUrl: string; title: string } | undefined {
    const link = el.find("h3 a").first();
    const href = link.attr("href") || "";
    if (!href) return undefined;
    const mangaId = this.parsePath(href);
    if (!mangaId) return undefined;
    const title = link.text().trim();
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

    const info = $("article#item-detail");
    const author = info.find("li.author p.col-xs-8").first().text().trim();
    const statusText = info.find("li.status p.col-xs-8").first().text().trim();

    const genres = info
      .find("li.kind p.col-xs-8 a")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((g) => g.length > 0);

    const otherName = info.find("h2.other-name").first().text().trim();
    const descParts = info
      .find("div.detail-content p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0);
    let synopsis = descParts.join("\n\n");
    if (otherName) {
      synopsis += `\n\nOther name: ${otherName}`;
    }

    const thumbnailUrl = this.imageFromElement(
      info.find("div.col-image img").first(),
    );

    const title =
      info.find("h1.title-detail").first().text().trim() ||
      this.safeDecode(mangaId);

    const secondaryTitles = otherName
      ? otherName
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : [];

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
        secondaryTitles,
        thumbnailUrl,
        author: author || undefined,
        artist: undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
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
    let url: string | undefined = this.mangaUrl(sourceManga.mangaId);
    const entries: { chapterId: string; name: string; date: Date }[] = [];
    const seen = new Set<string>();

    // recursively follow paginated chapter list
    for (let guard = 0; guard < 100 && url; guard++) {
      const $: CheerioAPI = await this.fetchCheerio({ url, method: "GET" });

      $("div.list-chapter li.row:not(.heading)").each((_, element) => {
        const el = $(element);
        const link = el.find("a").first();
        const href = link.attr("href") || "";
        if (!href) return;
        const chapterId = this.parsePath(href);
        if (!chapterId || seen.has(chapterId)) return;
        seen.add(chapterId);
        const name = link.text().trim();
        const dateText = el.find("div.col-xs-3").first().text().trim();
        entries.push({
          chapterId,
          name,
          date: this.parseDate(dateText),
        });
      });

      const next = $("ul.pagination a[rel=next]").first().attr("href") || "";
      url = next ? this.absoluteUrl(next) : undefined;
    }

    return entries.map((entry, index) => ({
      chapterId: entry.chapterId,
      sourceManga,
      title: entry.name,
      volume: 0,
      chapNum: this.parseChapterNumber(entry.name) || entries.length - index,
      publishDate: entry.date,
      langCode: "🇬🇧",
    }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${this.chapterUrl(chapter.chapterId)}/all`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const imageUrls: string[] = [];
    const seen = new Set<string>();
    $("div.page-chapter > img, li.blocks-gallery-item img").each(
      (_, element) => {
        const src = this.imageFromElement($(element));
        if (!src || seen.has(src)) return;
        seen.add(src);
        imageUrls.push(src);
      },
    );

    // XOXO/wpcomics serves page images with an HTTP 404 status even when the
    // image bytes are valid (see the upstream XoxoComics image interceptor,
    // which rewrites 404 -> 200). Paperback's native image serializer rejects
    // that response before the bytes are decoded, surfacing as an Alamofire
    // "imageSerializationFailed" error. Response.status is read-only and the
    // response interceptor can only return the body, so we cannot rewrite the
    // status. Instead, fetch each page ourselves (scheduleRequest returns the
    // bytes regardless of status) and hand the reader inline data URIs.
    const pages: string[] = [];
    for (const imageUrl of imageUrls) {
      pages.push(await this.fetchImageAsDataUri(imageUrl));
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  private async fetchImageAsDataUri(imageUrl: string): Promise<string> {
    try {
      const [response, data] = await Application.scheduleRequest({
        url: imageUrl,
        method: "GET",
      });

      // If Cloudflare interposes a challenge on the image request, escalate so
      // the reader shows the bypass flow instead of a broken image.
      if (isCloudflareChallenge(response, data)) {
        throw new CloudflareError({
          url: imageUrl,
          method: "GET",
          headers: {
            "user-agent": await Application.getDefaultUserAgent(),
          },
        });
      }

      const mimeType = detectImageMime(data, imageUrl);
      if (!mimeType) {
        // Not image bytes (e.g. an HTML error page) — fall back to the raw URL
        // so the reader can at least attempt its own fetch.
        return imageUrl;
      }

      const b64 = toBase64String(Application.base64Encode(data));
      return `data:${mimeType};base64,${b64}`;
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      // Any other failure: fall back to the plain URL.
      return imageUrl;
    }
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

  private parseChapterNumber(name: string): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private imageFromElement(img: Cheerio<AnyNode>): string {
    const src =
      img.attr("data-original") ||
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

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (
      s.includes("ongoing") ||
      s.includes("updating") ||
      s.includes("đang")
    ) {
      return "Ongoing";
    }
    if (
      s.includes("complete") ||
      s.includes("full") ||
      s.includes("hoàn thành")
    ) {
      return "Completed";
    }
    if (s.includes("tạm ngưng") || s.includes("tạm hoãn")) {
      return "Hiatus";
    }
    return "Unknown";
  }

  private parseDate(dateText: string): Date {
    const text = (dateText || "").trim();
    if (!text) return new Date(0);
    // upstream dateFormat: MM/dd/yyyy
    const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const month = parseInt(m[1], 10) - 1;
      const day = parseInt(m[2], 10);
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date(0);
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

export const XOXOComics = new XOXOComicsExtension();
