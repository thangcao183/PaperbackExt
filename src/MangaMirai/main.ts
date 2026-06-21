import {
  AdvancedSearchForm,
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
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import * as htmlparser2 from "htmlparser2";
import { MangaMiraiSearchForm, MangaMiraiSearchMeta } from "./forms";
import { getHideLocked, MangaMiraiSettingsForm } from "./settings";

const BASE_URL = "https://mangamirai.com";

interface ViewerPage {
  page: number;
  scramble_key: string;
  url: string;
}

interface ViewerResponse {
  records: ViewerPage[];
}

class MangaMiraiInterceptor extends PaperbackInterceptor {
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
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }

    // Scrambled images carry their base64 scramble key in the URL fragment.
    const fragment = request.url.split("#")[1] ?? "";
    if (fragment.length > 0) {
      try {
        return await descrambleImage(request.url, data);
      } catch {
        return data;
      }
    }

    return data;
  }
}

type MangaMiraiImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MangaMiraiExtension implements MangaMiraiImplementation {
  requestManager = new MangaMiraiInterceptor("main");
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

  async getSettingsForm(): Promise<Form> {
    return new MangaMiraiSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
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
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const order = section.id === "popular" ? "ranking" : "new";
    const url = this.buildSearchUrl("", page, { order: [order] });
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const itemType =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";
    const entries = this.parseCards($);
    const items: DiscoverSectionItem[] = entries.map((e) => ({
      type: itemType,
      mangaId: e.mangaId,
      imageUrl: e.imageUrl,
      title: e.title,
      metadata: undefined,
    }));

    const hasNext = $("a[rel=next]").length > 0;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (
      query.metadata as { searchMeta?: MangaMiraiSearchMeta } | undefined
    )?.searchMeta;

    const url = this.buildSearchUrl(titleQuery, page, searchMeta ?? {});
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: SearchResultItem[] = this.parseCards($).map((e) => ({
      mangaId: e.mangaId,
      imageUrl: e.imageUrl,
      title: e.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNext = $("a[rel=next]").length > 0;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = (
      query.metadata as { searchMeta?: MangaMiraiSearchMeta } | undefined
    )?.searchMeta;
    return new MangaMiraiSearchForm(meta);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const $ = await this.fetchCheerio({
      url: `${BASE_URL}/product_collections/${slug}`,
      method: "GET",
    });

    const title = $("h1").first().text().trim() || slug;
    const thumbnail = this.absoluteUrl(
      $("div.grid-cols-5.justify-between img").first().attr("src") ?? "",
    );
    const synopsis = $(
      "span[data-product-collections--product-collection--long-description-accordion-target]",
    )
      .first()
      .text()
      .trim();

    const authors: string[] = [];
    $("h1 ~ table a[href^=/authors/]").each((_i, el) => {
      const t = $(el).text().trim();
      if (t.length > 0) authors.push(t);
    });

    const genres: string[] = [];
    $("div.hidden > .popular-categories a").each((_i, el) => {
      const t = $(el).text().trim();
      if (t.length > 0) genres.push(t);
    });

    const status =
      $(".popular-categories a[href*=/tags/Completed]").length > 0
        ? "Completed"
        : "Ongoing";

    const tagGroups: TagSection[] =
      genres.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genres.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl: thumbnail,
        author: authors.length > 0 ? authors.join(", ") : undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status,
        tagGroups,
        shareUrl: `${BASE_URL}/product_collections/${slug}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const hideLocked = getHideLocked();
    const chapters: Chapter[] = [];

    let page = 1;
    while (page <= 100) {
      const $ = await this.fetchCheerio({
        url: `${BASE_URL}/product_collections/${slug}?page=${page}`,
        method: "GET",
      });

      const rows = $("div.pb-5").toArray();
      for (const row of rows) {
        const $row = $(row);
        const isBought = $row.find("a.gtm_read").length > 0;
        const isFree = $row.find("a.gtm_read_for_free").length > 0;
        const isPreview = $row.find("a.gtm_preview").length > 0;
        const isLocked = !isBought && !isFree && !isPreview;
        if (hideLocked && (isPreview || isLocked)) continue;

        const readerHref = $row.find("a[href*=/book_reader]").first().attr("href");
        const thumbHref = $row.find("a.gtm_thumbnail_tap").first().attr("href");
        let chapterId = "";
        if (readerHref) {
          const segs = this.pathSegments(this.absoluteUrl(readerHref));
          if (segs.length > 2) chapterId = segs[2];
        }
        if (!chapterId && thumbHref) {
          const segs = this.pathSegments(this.absoluteUrl(thumbHref));
          if (segs.length > 3) chapterId = segs[3];
        }
        if (!chapterId) continue;

        const baseName = $row.find("h3 span.font-bold").first().text().trim();
        const prefix = isPreview ? "🔒 (Preview) " : isLocked ? "🔒 " : "";
        const name = `${prefix}${baseName}`.trim() || `Chapter ${chapterId}`;

        chapters.push({
          chapterId: this.toSafeId(chapterId),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: this.parseChapterNumber(baseName, 0),
          publishDate: new Date(0),
          langCode: "🇬🇧",
        });
      }

      if ($("a[rel=next]").length === 0) break;
      page++;
    }

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = this.safeDecode(chapter.chapterId);
    const result = await this.fetchJson<ViewerResponse>({
      url: `${BASE_URL}/users/product_contents/${chapterId}/product_content_images?start_page=1&limit=10000`,
      method: "GET",
      headers: { accept: "*/*" },
    });

    const records = (result.records ?? []).slice().sort((a, b) => a.page - b.page);
    const pages = records.map((r) => `${r.url}#${r.scramble_key}`);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/product_collections/${this.safeDecode(mangaId)}`;
  }

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

  private buildSearchUrl(
    titleQuery: string,
    page: number,
    meta: Partial<MangaMiraiSearchMeta>,
  ): string {
    const params: string[] = [];
    if (titleQuery.length > 0)
      params.push(`word=${encodeURIComponent(titleQuery)}`);
    params.push(`page=${page}`);
    const order = meta.order?.[0] ?? "ranking";
    if (order.length > 0) params.push(`order=${encodeURIComponent(order)}`);
    const genre = meta.genre?.[0] ?? "";
    if (genre.length > 0) params.push(`genre=${encodeURIComponent(genre)}`);
    const publisher = meta.publisher?.[0] ?? "";
    if (publisher.length > 0)
      params.push(`publisher=${encodeURIComponent(publisher)}`);
    for (const tag of meta.tags ?? []) {
      if (tag.length > 0) params.push(`tags[]=${encodeURIComponent(tag)}`);
    }
    return `${BASE_URL}/search?${params.join("&")}`;
  }

  private parseCards(
    $: CheerioAPI,
  ): { mangaId: string; title: string; imageUrl: string }[] {
    const entries: { mangaId: string; title: string; imageUrl: string }[] = [];
    const seen = new Set<string>();
    $("div.card").each((_i, el) => {
      const $card = $(el);
      const href = $card.find("a").first().attr("href");
      if (!href) return;
      const segs = this.pathSegments(this.absoluteUrl(href));
      const slug = segs.length > 0 ? segs[segs.length - 1] : "";
      if (!slug) return;
      const mangaId = this.toSafeId(slug);
      if (seen.has(mangaId)) return;
      seen.add(mangaId);
      const title = $card.find("h3").first().text().trim();
      const imageUrl = this.absoluteUrl(
        $card.find("img").first().attr("src") ?? "",
      );
      entries.push({ mangaId, title, imageUrl });
    });
    return entries;
  }

  private pathSegments(url: string): string[] {
    const noQuery = url.split("#")[0].split("?")[0];
    const stripped = noQuery.replace(/^https?:\/\/[^/]+/, "");
    return stripped.split("/").filter((s) => s.length > 0);
  }

  private absoluteUrl(src: string): string {
    const s = src.trim();
    if (s.length === 0) return "";
    if (/^https?:\/\//.test(s)) return s;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `${BASE_URL}${s}`;
    return `${BASE_URL}/${s}`;
  }

  private parseChapterNumber(name: string, fallback: number): number {
    const m = name.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : fallback;
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

  private async fetchCheerio(request: Request): Promise<CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    const htmlStr = Application.arrayBufferToUTF8String(data);
    const dom = htmlparser2.parseDocument(htmlStr);
    return cheerio.load(dom);
  }

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) throw new Error("Content not found");
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }
}

// Decrypt (AES-CBC) then grid-descramble a MangaMirai image inside a webview canvas.
async function descrambleImage(
  url: string,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  const fragment = url.split("#")[1] ?? "";
  if (fragment.length === 0) return data;

  // The scramble key is base64; decoding yields a list of ints (the tile order).
  const decodedKey = base64ToString(fragment);
  const scrambleOrder = (decodedKey.match(/\d+/g) ?? []).map((n) =>
    parseInt(n, 10),
  );
  if (scrambleOrder.length === 0) return data;

  // contentsId = the 2nd path segment of the image request URL.
  const noQuery = url.split("#")[0].split("?")[0];
  const stripped = noQuery.replace(/^https?:\/\/[^/]+/, "");
  const segs = stripped.split("/").filter((s) => s.length > 0);
  const contentsId = segs.length > 1 ? segs[1] : "";

  const subtle = (globalThis as { crypto: { subtle: SubtleLike } }).crypto
    .subtle;

  const seed = utf8Bytes(`manga${contentsId}mirai`);
  const keyHash = new Uint8Array(await subtle.digest("SHA-256", bufferOf(seed)));

  const cryptoKey = await subtle.importKey(
    "raw",
    bufferOf(keyHash),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );

  const bytes = new Uint8Array(data);
  const iv = bytes.slice(0, 16);
  const ciphertext = bytes.slice(16);
  const decrypted = new Uint8Array(
    await subtle.decrypt(
      { name: "AES-CBC", iv: bufferOf(iv) },
      cryptoKey,
      bufferOf(ciphertext),
    ),
  );

  const b64 = Application.base64Encode(bufferOf(decrypted));
  const b64Str =
    typeof b64 === "string" ? b64 : Application.arrayBufferToUTF8String(b64);
  const dataUrl = `data:image/jpeg;base64,${b64Str}`;

  const inject = `
(function(){
  return new Promise(function(resolve){
    var img = new Image();
    img.onload = function(){
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        var order = ${JSON.stringify(scrambleOrder)};
        var cols = Math.floor((w + 95) / 96);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        for (var index = 0; index < order.length; index++) {
          var srcIndex = order[index];
          var srcX = (srcIndex % cols) * 96;
          var srcY = Math.floor(srcIndex / cols) * 96;
          var tw = Math.min(96, w - srcX);
          var th = Math.min(96, h - srcY);
          if (tw <= 0 || th <= 0) continue;
          var dstX = (index % cols) * 96;
          var dstY = Math.floor(index / cols) * 96;
          ctx.drawImage(img, srcX, srcY, tw, th, dstX, dstY, tw, th);
        }
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch (e) {
        resolve('');
      }
    };
    img.onerror = function(){ resolve(''); };
    img.src = ${JSON.stringify(dataUrl)};
  });
})()
`;

  const result = await Application.executeInWebView({
    source: {
      html: "<html><head></head><body></body></html>",
      baseUrl: BASE_URL,
      loadCSS: false,
      loadImages: true,
    },
    inject,
    storage: { cookies: [] },
  });

  const resultUrl = String(result.result || "");
  const commaIdx = resultUrl.indexOf(",");
  if (!resultUrl.startsWith("data:") || commaIdx < 0) return data;

  const payload = resultUrl.slice(commaIdx + 1);
  const decoded = Application.base64Decode(payload);
  if (typeof decoded === "string") {
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out.buffer;
  }
  return decoded;
}

function base64ToString(value: string): string {
  const decoded = Application.base64Decode(value);
  return typeof decoded === "string"
    ? decoded
    : Application.arrayBufferToUTF8String(decoded);
}

function utf8Bytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

interface SubtleLike {
  digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>;
  importKey(
    format: string,
    keyData: ArrayBuffer,
    algorithm: { name: string },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  decrypt(
    algorithm: { name: string; iv: ArrayBuffer },
    key: unknown,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
}

export const MangaMirai = new MangaMiraiExtension();
