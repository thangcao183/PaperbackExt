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
import { loadImageFromBuffer } from "../utils/descramble/canvas";

const BASE_URL = "https://comix.to";

// Some browse/latest-updates entries arrive without a poster. Paperback
// rejects list items (and manga details) that carry an empty imageUrl with
// "Could not convert JSValue: Invalid URL:", so fall back to a placeholder
// cover instead of an empty string.
const PLACEHOLDER_COVER =
  "https://imagizer.imageshack.com/img922/7118/ArGMjt.png";

// Grid-scramble constants — retained for the legacy 5x5 tile descramble path
// (only triggered if the CDN ever serves x-scramble-* headers again). The
// current site (post keiyoushi #16517) uses x-enc-* byte-XOR only.
const GRID_COLS = 5;
const GRID_ROWS = 5;
const NUM_TILES = GRID_COLS * GRID_ROWS;
const ENC_MULTIPLIER = 1000005;
const ENC_INCREMENT = 1234567891;
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

// ---------------------------------------------------------------------------
// WebView capture bootstraps.
//
// comix.to is a JS SPA whose browse/search/chapter/page lists arrive via SIGNED
// XHRs whose bodies are encrypted ({e:"blob"}); the site's own bundle decrypts
// them and calls JSON.parse on the plaintext. A static HTTP fetch therefore has
// NO list data. We load the page in a WebView and Proxy JSON.parse to capture
// that decrypted plaintext — so we never reimplement the rotating signer or the
// decryption. (Technique mirrors the inkdex Paperback extension.)
// ---------------------------------------------------------------------------

// Browse / search: resolve with the raw JSON string of the first decrypted
// `{result:{items:[{hid,...}],meta}}` payload.
const BROWSE_BOOTSTRAP = `
(function(){
  var doneResolve, done=false;
  window.__comixResult__ = new Promise(function(r){ doneResolve = r; });
  function finish(v){ if(done) return; done=true; doneResolve(v); }
  var orig = JSON.parse;
  JSON.parse = new Proxy(orig, { apply: function(t,a,args){
    var parsed = Reflect.apply(t,a,args);
    try {
      var r = parsed && parsed.result;
      if (r && Array.isArray(r.items) && r.items.length>0 && r.items[0] && r.items[0].hid !== undefined) {
        finish(args[0]);
      }
    } catch(e){}
    return parsed;
  }});
  setTimeout(function(){ finish(""); }, 20000);
})();
`;

// Chapter list: accumulate items across pages (click Next until lastPage),
// resolve with the accumulated array.
const CHAPTERS_BOOTSTRAP = `
(function(){
  var items=[], seen=new Set(), totalPages=null, submitted=false, doneResolve;
  // Lock onto the FIRST manga whose chapter list we observe. The detail page's
  // own chapter list loads first; related/recommended lists (a DIFFERENT
  // mangaId) load afterwards and previously leaked in as duplicate chapters.
  // We can't derive the id from the slug (the slug prefix != API mangaId), so
  // we capture it dynamically from the first valid payload.
  var lockedMangaId=null;
  window.__comixResult__ = new Promise(function(r){ doneResolve = r; });
  function submit(){ if(submitted) return; submitted=true; doneResolve(items); }
  var idleTimer;
  function armIdle(){ if(idleTimer) clearTimeout(idleTimer); idleTimer=setTimeout(submit, 20000); }
  armIdle();
  function gotoNext(){
    var tries=0;
    var iv=setInterval(function(){
      var btn=document.querySelector(".mchap-foot button[aria-label*=Next]");
      if(btn && !btn.disabled){ btn.click(); clearInterval(iv); }
      else if(++tries>50){ clearInterval(iv); submit(); }
    },100);
  }
  var orig=JSON.parse;
  JSON.parse=new Proxy(orig,{ apply:function(t,a,args){
    var parsed=Reflect.apply(t,a,args);
    try {
      if(!submitted && parsed && parsed.result && Array.isArray(parsed.result.items) &&
         parsed.result.items[0] && parsed.result.items[0].id !== undefined &&
         parsed.result.items[0].number !== undefined){
        var payloadMangaId=parsed.result.items[0].mangaId;
        if(lockedMangaId===null && payloadMangaId!==undefined) lockedMangaId=String(payloadMangaId);
        if(lockedMangaId===null || payloadMangaId===undefined || String(payloadMangaId)===lockedMangaId){
          var meta=parsed.result.meta || parsed.result.pagination;
          var page=(meta && meta.page) || 1;
          if(!seen.has(page)){
            seen.add(page);
            for(var i=0;i<parsed.result.items.length;i++){
              var it=parsed.result.items[i];
              if(lockedMangaId===null || it.mangaId===undefined || String(it.mangaId)===lockedMangaId) items.push(it);
            }
            if(totalPages===null && meta && typeof meta.lastPage==="number") totalPages=meta.lastPage;
            if(totalPages!==null && page<totalPages){ armIdle(); gotoNext(); } else submit();
          }
        }
      }
    } catch(e){}
    return parsed;
  }});
})();
`;

// Page list: capture BOTH the pages payload AND the exact query the SPA appends
// to its own CDN image requests. The CDN only emits the x-scramble-* headers
// when the image URL carries that query (a rotating signing token + a fresh
// timestamp, e.g. ?6a388ef0&6a389c10). We can't hardcode it (it rotates on
// deploy), so we grab whatever the SPA uses and reuse it for every page.
// Resolves with JSON: {"pages": "<rawPagesJson>", "q": "<imgQuery|null>"}.
const PAGES_BOOTSTRAP = `
(function(){
  var pagesPayload=null, imgQuery=null, done=false, doneResolve;
  window.__comixResult__ = new Promise(function(r){ doneResolve = r; });
  function finish(){ if(done) return; done=true; doneResolve(JSON.stringify({pages: pagesPayload, q: imgQuery})); }
  // imgQuery is diagnostic only (page URLs no longer use it), so finish as soon
  // as the page list is captured; allow a short grace window for the SPA to
  // fire an image request so the captured imgQuery log line is populated.
  function maybeFinish(){ if(pagesPayload){ setTimeout(finish, 400); } }
  function captureImgUrl(u){
    try {
      if(imgQuery || !u) return;
      if(/wowpic|\\/i5\\//.test(u)){
        var qi = u.indexOf('?');
        if(qi >= 0){ imgQuery = u.slice(qi+1); maybeFinish(); }
      }
    } catch(e){}
  }
  var of = window.fetch;
  if(typeof of === 'function'){
    window.fetch = function(){ try{ var a=arguments[0]; captureImgUrl(typeof a==='string'?a:(a&&a.url)); }catch(e){} return of.apply(this, arguments); };
  }
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m,u){ captureImgUrl(String(u||'')); return oo.apply(this, arguments); };
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if(desc && desc.set){
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable:true, get:desc.get,
        set:function(v){ captureImgUrl(String(v||'')); return desc.set.call(this, v); }
      });
    }
  } catch(e){}
  var op = JSON.parse;
  JSON.parse = new Proxy(op, { apply:function(t,a,args){
    var parsed = Reflect.apply(t,a,args);
    try { if(!pagesPayload && parsed && parsed.result && parsed.result.pages){ pagesPayload = args[0]; maybeFinish(); } } catch(e){}
    return parsed;
  }});
  // Give the SPA time to issue at least one image request after the page list.
  setTimeout(finish, 15000);
})();
`;

interface ComixMetadata {
  page?: number;
}

// ----------------------------------------------------------------
// Upstream JSON shapes (subset of the comix.to API embedded in the
// server-rendered `<script id="initial-data">` blob).
// ----------------------------------------------------------------

interface Term {
  title?: string;
}

interface Poster {
  small?: string;
  medium?: string;
  large?: string;
}

interface MangaDto {
  hid?: string;
  title?: string;
  altTitles?: string[];
  alt_titles?: string[];
  synopsis?: string | null;
  type?: string;
  poster?: Poster | null;
  status?: string;
  contentRating?: string;
  authors?: Term[] | null;
  author?: Term[] | null;
  artists?: Term[] | null;
  artist?: Term[] | null;
  genres?: Term[] | null;
  genre?: Term[] | null;
  tags?: Term[] | null;
  demographics?: Term[] | null;
  demographic?: Term[] | null;
  year?: number | null;
  url?: string | null;
}

interface ChapterDto {
  id?: number;
  url?: string;
  number?: number;
  name?: string;
  createdAtFormatted?: string;
  group?: { id?: number; name?: string } | null;
  isOfficial?: boolean;
}

interface PageDto {
  url?: string;
  s?: number;
}

// ----------------------------------------------------------------
// Interceptor
// ----------------------------------------------------------------

class ComixInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const urlWithoutFragment = request.url.split("#")[0];
    const fragment = request.url.split("#")[1] ?? "";

    // V3 grid-scramble pages (tagged `#v3`) MUST NOT send Origin — the CDN
    // withholds the x-scramble-seed header when Origin is present. Legacy
    // scramble pages (tagged `#scrambled`, non-v3) MUST keep Origin so the CDN
    // returns the x-enc-seed/x-enc-len headers interceptResponse uses. Plain
    // off-host images (e.g. wowpic) return a bad variant with Origin, so they
    // also drop it. We tag intent in the URL fragment so we can decide here
    // without re-parsing query params.
    let host = "";
    try {
      host = urlWithoutFragment.replace(/^https?:\/\//, "").split("/")[0];
    } catch {
      host = "";
    }
    const isV3 = fragment.includes("v3");
    const isLegacyScramble = fragment.includes("scrambled") && !isV3;
    const isOffHostImage =
      host.length > 0 && !host.includes("comix.to");
    const dropOrigin = isOffHostImage && !isLegacyScramble;

    const headers: Record<string, string> = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "*/*",
      "accept-language": "en-US,en;q=0.5",
    };
    if (!dropOrigin) {
      headers.origin = BASE_URL;
    } else {
      delete headers.origin;
    }
    request.headers = headers;

    // Strip our private fragment markers before the request goes out so the
    // server sees a clean URL (the descramble parameters arrive in headers).
    request.url = urlWithoutFragment;
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

    if (response.status < 200 || response.status >= 300) return data;

    try {
      return await decodeScrambledImage(response.headers, data);
    } catch {
      // Never throw out of interceptResponse — fall back to original bytes.
      return data;
    }
  }
}

type ComixImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class ComixExtension implements ComixImplementation {
  requestManager = new ComixInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
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
        title: "Popular",
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
    const meta = metadata as ComixMetadata | undefined;
    const page = meta?.page ?? 1;

    const rating = "content_rating=safe,suggestive,erotica,pornographic";
    const url =
      section.id === "popular"
        ? `${BASE_URL}/browse?order%5Bviews_30d%5D=desc&${rating}&page=${page}`
        : `${BASE_URL}/browse?order%5Bchapter_updated_at%5D=desc&${rating}&page=${page}`;

    const { mangas, hasNextPage } = await this.fetchBrowse(url);

    const items: DiscoverSectionItem[] = mangas.map((m) => ({
      type:
        section.id === "popular"
          ? "featuredCarouselItem"
          : "simpleCarouselItem",
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as ComixMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    // Pasting a comix.to title URL jumps straight to that series.
    const titlePath = this.titlePathFromQuery(titleQuery);
    if (titlePath) {
      const sourceManga = await this.getMangaDetails(titlePath);
      return {
        items: [
          {
            mangaId: sourceManga.mangaId,
            imageUrl: sourceManga.mangaInfo.thumbnailUrl,
            title: sourceManga.mangaInfo.primaryTitle,
            subtitle: undefined,
            metadata: undefined,
          },
        ],
        metadata: undefined,
      };
    }

    const params: string[] = [];
    params.push("content_rating=safe,suggestive,erotica,pornographic");
    if (titleQuery) {
      params.push(`keyword=${encodeURIComponent(titleQuery)}`);
    } else {
      params.push("order%5Bviews_30d%5D=desc");
    }
    params.push(`page=${page}`);

    const url = `${BASE_URL}/browse?${params.join("&")}`;
    const { mangas, hasNextPage } = await this.fetchBrowse(url);

    const items: SearchResultItem[] = mangas.map((m) => ({
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const root = this.extractInitialData($);
    const detail = root ? this.findDetailManga(root) : undefined;

    if (!detail) {
      return {
        mangaId,
        mangaInfo: {
          primaryTitle: this.safeDecode(mangaId),
          secondaryTitles: [],
          thumbnailUrl: PLACEHOLDER_COVER,
          synopsis: "",
          contentRating: ContentRating.MATURE,
          status: "Unknown",
          tagGroups: [],
          shareUrl: url,
        },
      };
    }

    const authors = (detail.authors ?? detail.author ?? [])
      .map((t) => (t.title ?? "").trim())
      .filter((t) => t.length > 0)
      .join(", ");
    const artists = (detail.artists ?? detail.artist ?? [])
      .map((t) => (t.title ?? "").trim())
      .filter((t) => t.length > 0)
      .join(", ");

    const genreNames: string[] = [];
    switch (detail.type) {
      case "manhwa":
        genreNames.push("Manhwa");
        break;
      case "manhua":
        genreNames.push("Manhua");
        break;
      case "manga":
        genreNames.push("Manga");
        break;
      default:
        genreNames.push("Other");
        break;
    }
    for (const t of detail.genres ?? detail.genre ?? []) {
      const n = (t.title ?? "").trim();
      if (n) genreNames.push(n);
    }
    for (const t of detail.demographics ?? detail.demographic ?? []) {
      const n = (t.title ?? "").trim();
      if (n) genreNames.push(n);
    }
    const cr = detail.contentRating ?? "safe";
    if (cr === "erotica" || cr === "pornographic") genreNames.push("NSFW");

    const tagGroups: TagSection[] = [];
    const uniqueGenres = [...new Set(genreNames)];
    if (uniqueGenres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: uniqueGenres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    const altTitles = (detail.altTitles ?? detail.alt_titles ?? []).filter(
      (s) => !!s && s.length > 0,
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: detail.title ?? this.safeDecode(mangaId),
        secondaryTitles: altTitles,
        thumbnailUrl: this.posterUrl(detail.poster),
        author: authors || undefined,
        artist: artists || undefined,
        synopsis: detail.synopsis ?? "",
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(detail.status ?? ""),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaSlug = this.safeDecode(sourceManga.mangaId).replace(/^\/+/, "");
    const rawChapters = await this.captureChapters(
      this.mangaUrl(sourceManga.mangaId),
    );

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const ch of rawChapters) {
      if (ch.id === undefined || ch.number === undefined) continue;
      const numStr = ch.number.toString();
      const chapterUrlPath =
        ch.url && ch.url.indexOf("/title/") !== -1
          ? ch.url.substring(ch.url.indexOf("/title/"))
          : `/title/${mangaSlug}/${ch.id}-chapter-${numStr}`;
      const chapterId = this.parsePath(chapterUrlPath);
      if (!chapterId || seen.has(chapterId)) continue;
      seen.add(chapterId);

      const namePart =
        ch.name && ch.name.trim().length > 0 ? `: ${ch.name.trim()}` : "";
      chapters.push({
        chapterId,
        sourceManga,
        title: `Chapter ${numStr}${namePart}`,
        volume: 0,
        chapNum: ch.number,
        publishDate: this.parseRelativeDate(ch.createdAtFormatted ?? ""),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const result = await this.capturePages(this.chapterUrl(chapter.chapterId));

    const pages: string[] = [];
    if (result) {
      const base = (result.baseUrl ?? "").replace(/\/+$/, "");
      // comix.to restored the 5x5 grid-scramble protection (keiyoushi #16655 →
      // #17035, 2026-06): two distinct page variants now coexist.
      //
      //  - V3 grid-scramble: API marks the page (`s === 1`) OR the captured URL
      //    already carries a `?v3` flag. The CDN serves these scrambled and
      //    returns x-scramble-* (+ optional x-enc-*) headers ONLY when the `v3`
      //    query param is present AND the Origin header is ABSENT (it withholds
      //    x-scramble-seed when Origin is sent). We ensure `v3` is in the query
      //    and tag `#v3` so interceptRequest drops Origin for these.
      //  - Legacy scramble: every 4th non-v3 page is obfuscated; tagged
      //    `#scrambled`, and these MUST keep Origin.
      //  - Everything else is plain; off-host plain images get Origin dropped.
      //
      // The hex token (e.g. `?6a38ff90&v3`) originates from the SPA's own image
      // URL — we never synthesize one; we just guarantee `v3` is present.
      result.items.forEach((img, index) => {
        const raw = (img.url ?? "").trim();
        if (!raw) return;
        const full = raw.startsWith("http")
          ? raw
          : `${base}/${raw.replace(/^\/+/, "")}`;

        const isV3 = img.s === 1 || /[?&]v3(\b|=|&|$)/.test(full);
        const isLegacyScramble = !isV3 && (index + 1) % 4 === 0;

        if (isV3) {
          // Ensure the `v3` query flag is present, then tag `#v3`.
          let v3Url = full;
          if (!/[?&]v3(\b|=|&|$)/.test(v3Url)) {
            v3Url += v3Url.includes("?") ? "&v3" : "?v3";
          }
          pages.push(`${v3Url}#v3`);
        } else if (isLegacyScramble) {
          pages.push(`${full}#scrambled`);
        } else {
          pages.push(full);
        }
      });
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
  // WebView capture (browse/search/chapters/pages arrive via signed,
  // encrypted XHRs — load the page and proxy JSON.parse to grab the
  // decrypted plaintext; see the *_BOOTSTRAP scripts above).
  // ----------------------------------------------------------------

  private async runProxiedWebView(
    pageUrl: string,
    bootstrap: string,
  ): Promise<unknown> {
    const cookies = this.cookieStorageInterceptor.cookiesForUrl(`${BASE_URL}/`);
    const userAgent = await Application.getDefaultUserAgent();
    const [, buffer] = await Application.scheduleRequest({
      url: pageUrl,
      method: "GET",
    });
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    $("head").prepend(`<script>${bootstrap}</script>`);
    const raw = await Application.executeInWebView({
      source: {
        html: $.html(),
        baseUrl: pageUrl,
        loadCSS: false,
        loadImages: false,
        userAgent,
      },
      inject: `return window.__comixResult__`,
      storage: { cookies },
    });
    return raw.result;
  }

  private async captureBrowse(
    browseUrl: string,
  ): Promise<{ items: MangaDto[]; hasNextPage: boolean } | undefined> {
    const raw = await this.runProxiedWebView(browseUrl, BROWSE_BOOTSTRAP);
    if (typeof raw !== "string" || !raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    return this.findBrowseItems({ cap: parsed });
  }

  private async captureChapters(pageUrl: string): Promise<ChapterDto[]> {
    const raw = await this.runProxiedWebView(pageUrl, CHAPTERS_BOOTSTRAP);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (c): c is ChapterDto =>
        !!c && typeof c === "object" && (c as ChapterDto).id !== undefined,
    );
  }

  private async capturePages(pageUrl: string): Promise<
    | { baseUrl: string; items: PageDto[]; imgQuery?: string }
    | undefined
  > {
    const raw = await this.runProxiedWebView(pageUrl, PAGES_BOOTSTRAP);
    if (typeof raw !== "string" || !raw) return undefined;
    let outer: unknown;
    try {
      outer = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const pagesStr = (outer as { pages?: unknown } | null)?.pages;
    const q = (outer as { q?: unknown } | null)?.q;
    const imgQuery = typeof q === "string" && q.length > 0 ? q : undefined;
    if (typeof pagesStr !== "string") return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(pagesStr);
    } catch {
      return undefined;
    }
    const found = this.findPages({ cap: parsed });
    return found ? { ...found, imgQuery } : undefined;
  }

  // ----------------------------------------------------------------
  // Browse helper
  // ----------------------------------------------------------------

  private async fetchBrowse(url: string): Promise<{
    mangas: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  }> {
    const items = await this.captureBrowse(url);

    if (!items) return { mangas: [], hasNextPage: false };

    const mangas: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const m of items.items) {
      const slug = m.url
        ? m.url.substring(m.url.indexOf("/title") + "/title".length)
        : m.hid
          ? `/${m.hid}`
          : "";
      const mangaId = this.parsePath(slug);
      if (!mangaId || seen.has(mangaId)) continue;
      seen.add(mangaId);
      mangas.push({
        mangaId,
        imageUrl: this.posterUrl(m.poster),
        title: m.title ?? this.safeDecode(mangaId),
      });
    }

    return { mangas, hasNextPage: items.hasNextPage };
  }

  // ----------------------------------------------------------------
  // initial-data parsing
  // ----------------------------------------------------------------

  private extractInitialData(
    $: CheerioAPI,
  ): Record<string, unknown> | undefined {
    const raw = $("script#initial-data").first().text();
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      const queries = (parsed as { queries?: unknown })?.queries;
      if (queries && typeof queries === "object") {
        return queries as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private findBrowseItems(
    queries: Record<string, unknown>,
  ): { items: MangaDto[]; hasNextPage: boolean } | undefined {
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (result && Array.isArray((result as { items?: unknown }).items)) {
        const itemsRaw = (result as { items: unknown[] }).items;
        if (itemsRaw.length === 0) continue;
        // Differentiate manga lists from chapter lists by sampling the first item.
        const first = itemsRaw[0] as Record<string, unknown>;
        if (first && (first.title !== undefined || first.hid !== undefined)) {
          return {
            items: itemsRaw as MangaDto[],
            hasNextPage: this.computeHasNextPage(result),
          };
        }
      }
    }
    return undefined;
  }


  private findDetailManga(
    queries: Record<string, unknown>,
  ): MangaDto | undefined {
    // The detail query key contains the literal string "detail".
    for (const [key, value] of Object.entries(queries)) {
      if (!key.includes("detail")) continue;
      const result = this.getResult(value);
      if (result && typeof result === "object") {
        const candidate = result as MangaDto;
        if (candidate.title !== undefined || candidate.hid !== undefined) {
          return candidate;
        }
      }
    }
    // Fallback: any query whose result looks like a single manga.
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (result && typeof result === "object") {
        const candidate = result as MangaDto;
        if (
          (candidate.title !== undefined || candidate.hid !== undefined) &&
          (candidate as { items?: unknown }).items === undefined
        ) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private findPages(
    queries: Record<string, unknown>,
  ): { baseUrl: string; items: PageDto[] } | undefined {
    for (const value of Object.values(queries)) {
      const result = this.getResult(value);
      if (!result || typeof result !== "object") continue;
      const pages = (result as { pages?: unknown }).pages;
      if (pages && typeof pages === "object") {
        const p = pages as { baseUrl?: string; items?: unknown };
        if (Array.isArray(p.items)) {
          return {
            baseUrl: p.baseUrl ?? "",
            items: p.items as PageDto[],
          };
        }
      }
    }
    return undefined;
  }

  // Each React-Query entry may be the result object directly, or wrapped in
  // `{ result: ... }`, or in a React-Query `{ state: { data: ... } }` shape.
  private getResult(value: unknown): unknown {
    if (!value || typeof value !== "object") return undefined;
    const obj = value as Record<string, unknown>;
    if (obj.result !== undefined) {
      const r = obj.result as Record<string, unknown>;
      if (r && typeof r === "object" && r.result !== undefined) {
        return r.result;
      }
      return obj.result;
    }
    if (obj.state && typeof obj.state === "object") {
      const data = (obj.state as Record<string, unknown>).data;
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        return d.result !== undefined ? d.result : d;
      }
    }
    return obj;
  }

  private computeHasNextPage(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const obj = result as Record<string, unknown>;
    const metaLike = (obj.meta ?? obj.pagination) as
      | Record<string, unknown>
      | undefined;
    if (!metaLike) return false;
    if (typeof metaLike.hasNext === "boolean") return metaLike.hasNext;
    const page = this.asNumber(metaLike.page) ?? 1;
    const lastPage =
      this.asNumber(metaLike.lastPage) ??
      this.asNumber(metaLike.last_page) ??
      1;
    return page < lastPage;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private titlePathFromQuery(query: string): string | undefined {
    const trimmed = query.trim();
    if (!trimmed) return undefined;
    let parsedHost = "";
    let pathSegments: string[] = [];
    try {
      const u = new URL(trimmed);
      parsedHost = u.host.replace(/^www\./, "");
      pathSegments = u.pathname.split("/").filter((s) => s.length > 0);
    } catch {
      return undefined;
    }
    if (parsedHost !== "comix.to") return undefined;
    if (pathSegments.length < 2 || pathSegments[0] !== "title")
      return undefined;
    const mangaId = pathSegments[1].split("-")[0];
    if (!mangaId) return undefined;
    return this.parsePath(`/${mangaId}`);
  }

  private posterUrl(poster: Poster | null | undefined): string {
    if (!poster) return PLACEHOLDER_COVER;
    return poster.large || poster.medium || poster.small || PLACEHOLDER_COVER;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/title/${slug.replace(/^\/+/, "")}`;
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

  private parseStatus(status: string): string {
    switch (status) {
      case "releasing":
        return "Ongoing";
      case "on_hiatus":
        return "Hiatus";
      case "finished":
        return "Completed";
      case "discontinued":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }

  private parseRelativeDate(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    const trimmed = dateStr.trim().toLowerCase().replace(/ ago$/, "");
    const match = trimmed.match(
      /^(\d+)\s*(s|m|h|d|w|mo|mos|y|yr|yrs|min|mins|sec|secs|hr|hrs|day|days|week|weeks|month|months|year|years)$/,
    );
    if (!match) return new Date(0);
    const amount = parseInt(match[1], 10);
    if (Number.isNaN(amount)) return new Date(0);
    const unit = match[2];
    const now = Date.now();
    const sec = 1000;
    const min = 60 * sec;
    const hour = 60 * min;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;
    let offset = 0;
    switch (unit) {
      case "s":
      case "sec":
      case "secs":
        offset = amount * sec;
        break;
      case "m":
      case "min":
      case "mins":
        offset = amount * min;
        break;
      case "h":
      case "hr":
      case "hrs":
        offset = amount * hour;
        break;
      case "d":
      case "day":
      case "days":
        offset = amount * day;
        break;
      case "w":
      case "week":
      case "weeks":
        offset = amount * week;
        break;
      case "mo":
      case "mos":
      case "month":
      case "months":
        offset = amount * month;
        break;
      case "y":
      case "yr":
      case "yrs":
      case "year":
      case "years":
        offset = amount * year;
        break;
      default:
        return new Date(0);
    }
    return new Date(now - offset);
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

// --------------------------------------------------------------------
// Image decryption / descrambling (module-level helpers)
//
// Faithful port of the upstream Descrambler.kt okhttp interceptor:
//   1. Read the x-enc-* / x-scramble-* headers from the response.
//   2. If x-enc-seed is present and non-zero, XOR-decode the bytes with the
//      LCG or xorshift keystream (algo-dependent) — a pure byte transform.
//   3. If x-scramble-grid == "5x5", undo a 5x5 tile permutation keyed by
//      (scrambleSeed XOR scrambleHash) via an in-process canvas remap
//      (remapTilesByLookup from the shared descramble helpers).
// --------------------------------------------------------------------

async function decodeScrambledImage(
  headers: Record<string, string>,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  const rawScrambleGrid = headerValue(headers, "x-scramble-grid");
  const rawScrambleAlgo = headerValue(headers, "x-scramble-algo");
  const rawScrambleHash = headerValue(headers, "x-scramble-hash");
  const rawScrambleSeed = headerValue(headers, "x-scramble-seed");
  const rawEncSeed = headerValue(headers, "x-enc-seed");
  const rawEncAlgo = headerValue(headers, "x-enc-algo");
  const rawEncLen = headerValue(headers, "x-enc-len");

  const encSeed = toInt32(rawEncSeed);
  const encLen = parseIntOrNull(rawEncLen);
  const scrambleSeed = toInt32(rawScrambleSeed);
  const scrambleHash = decodeScrambleHash(rawScrambleHash);

  const needsXor = encSeed !== null && encSeed !== 0 && encLen !== null;
  const shouldDescrambleGrid =
    rawScrambleGrid === "5x5" &&
    (rawScrambleAlgo === undefined ||
      rawScrambleAlgo === "1" ||
      rawScrambleAlgo === "2" ||
      rawScrambleAlgo === "3") &&
    scrambleSeed !== null &&
    scrambleSeed !== 0;

  if (!needsXor && !shouldDescrambleGrid) return data;

  let bytes: Uint8Array = new Uint8Array(data);
  if (needsXor && encSeed !== null && encLen !== null) {
    bytes = decodeEncodedBytes(bytes, encSeed, encLen, rawEncAlgo);
  }

  if (shouldDescrambleGrid && scrambleSeed !== null) {
    const seed = (scrambleSeed ^ scrambleHash) | 0;
    const order = buildTileOrder(seed, rawScrambleAlgo);
    const decodeMime =
      sniffImageMime(bytes) ??
      stripMimeParams(headerValue(headers, "content-type")) ??
      "image/jpeg";

    // Step 1: Load source image (may be webp/png/jpeg)
    const srcImg = await loadImageFromBuffer(bufferOf(bytes), decodeMime);
    const width = srcImg.naturalWidth || srcImg.width;
    const height = srcImg.naturalHeight || srcImg.height;
    if (!width || !height) {
      return bufferOf(bytes);
    }

    // Step 2: If source is WebP, transcode to JPEG first.
    // The polyfill's 9-arg drawImage sub-region crop may not work correctly
    // for WebP-sourced Image objects, but full-image drawImage (no crop) works.
    // Mangago (JPEG) works fine with 9-arg crop — so transcode first, then crop.
    let tileSource = srcImg;
    if (decodeMime !== "image/jpeg") {
      const transCanvas = new HTMLCanvasElement();
      transCanvas.width = width;
      transCanvas.height = height;
      const transCtx = transCanvas.getContext("2d");
      if (!transCtx) return bufferOf(bytes);
      transCtx.drawImage(srcImg, 0, 0, width, height);
      const jpegUrl = transCanvas.toDataURL("image/jpeg", 0.95);
      const commaT = jpegUrl.indexOf(",");
      const jpegB64 = jpegUrl.slice(commaT + 1);
      const jpegDecoded = Application.base64Decode(jpegB64);
      let jpegBuf: ArrayBuffer;
      if (typeof jpegDecoded === "string") {
        const u8 = new Uint8Array(jpegDecoded.length);
        for (let c = 0; c < jpegDecoded.length; c++)
          u8[c] = jpegDecoded.charCodeAt(c);
        jpegBuf = u8.buffer;
      } else {
        jpegBuf = jpegDecoded as ArrayBuffer;
      }
      tileSource = await loadImageFromBuffer(jpegBuf, "image/jpeg");
      const w2 = tileSource.naturalWidth || tileSource.width;
      const h2 = tileSource.naturalHeight || tileSource.height;
      if (!w2 || !h2) return bufferOf(bytes);
    }

    // Step 3: tile remap via MANUAL PIXEL COPY (getImageData/putImageData).
    // The polyfill's 9-arg drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh) does NOT
    // crop the source sub-rectangle (proven by v1.4.31.20 logs: pipeline
    // completes with correct dims but output stays scrambled). So we copy raw
    // RGBA bytes between tile rectangles by hand — no drawImage cropping.
    const tw = (width / GRID_COLS) | 0;
    const th = (height / GRID_ROWS) | 0;
    if (tw === 0 || th === 0) return bufferOf(bytes);

    const outCanvas = new HTMLCanvasElement();
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) return bufferOf(bytes);

    // Draw the full image first so the right/bottom remainder survives.
    outCtx.drawImage(tileSource, 0, 0, width, height);

    // Tile remap using ONLY the 4-arg drawImage(img, x, y, w, h) primitive,
    // which is the one canvas op proven to work in Paperback's polyfill (the
    // WebP->JPEG transcode above uses it successfully). We avoid:
    //   - 9-arg drawImage crop  -> polyfill ignores the source sub-rect (no-op,
    //     v1.4.31.20: completes with correct dims but output stays scrambled)
    //   - getImageData/putImageData -> unreliable Y origin re-scrambles output
    //     (v1.4.31.21: tiles moved but landed in wrong cells, upright interiors)
    //
    // To crop source tile `srcIdx` without a crop primitive: draw the FULL image
    // into a tile-sized scratch canvas shifted by (-srcX0, -srcY0) so only that
    // tile lands inside the scratch bounds, then draw the scratch (1:1, no
    // scaling) to the destination tile position. Both are plain 4-arg draws.
    //
    // Verified against ground truth (Python seam-recovery on a real scrambled
    // page, seed=2397601448): clean[dst] = scrambled[order[dst]] is correct.
    const scratch = new HTMLCanvasElement();
    scratch.width = tw;
    scratch.height = th;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return bufferOf(bytes);

    for (let dstIdx = 0; dstIdx < NUM_TILES; dstIdx++) {
      const srcIdx = order[dstIdx];
      const srcX0 = (srcIdx % GRID_COLS) * tw;
      const srcY0 = ((srcIdx / GRID_COLS) | 0) * th;
      const dstX0 = (dstIdx % GRID_COLS) * tw;
      const dstY0 = ((dstIdx / GRID_COLS) | 0) * th;
      // Shift the whole image so source tile (srcX0,srcY0) maps to scratch (0,0).
      scratchCtx.clearRect(0, 0, tw, th);
      scratchCtx.drawImage(tileSource, -srcX0, -srcY0, width, height);
      // Place the cropped tile (1:1) at the destination position.
      outCtx.drawImage(scratch, dstX0, dstY0, tw, th);
    }

    // DEBUG: draw a magenta border around descrambled pages so it is visually
    // obvious which pages went through the grid descrambler. Uses fillRect (4
    // edge bars) instead of strokeRect because Paperback's canvas polyfill is
    // unreliable for stroked paths. Remove once descramble is verified on device.
    const borderPx = Math.max(8, Math.round(Math.min(width, height) * 0.01));
    outCtx.fillStyle = "#FF00FF";
    outCtx.fillRect(0, 0, width, borderPx); // top
    outCtx.fillRect(0, height - borderPx, width, borderPx); // bottom
    outCtx.fillRect(0, 0, borderPx, height); // left
    outCtx.fillRect(width - borderPx, 0, borderPx, height); // right

    const resultUrl = outCanvas.toDataURL("image/jpeg", 0.90);
    const commaIdx = resultUrl.indexOf(",");
    if (commaIdx < 0) return bufferOf(bytes);
    const payload = resultUrl.slice(commaIdx + 1);
    const resultDecoded = Application.base64Decode(payload);
    let resultBuf: ArrayBuffer;
    if (typeof resultDecoded === "string") {
      const u8 = new Uint8Array(resultDecoded.length);
      for (let c = 0; c < resultDecoded.length; c++)
        u8[c] = resultDecoded.charCodeAt(c);
      resultBuf = u8.buffer;
    } else {
      resultBuf = resultDecoded as ArrayBuffer;
    }
    return resultBuf;
  }

  return bufferOf(bytes);
}

function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = parseInt(value.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

// Parse a possibly-large numeric header into a 32-bit signed Int, matching
// Kotlin's `toLongOrNull()?.toInt()` (which truncates to the low 32 bits).
function toInt32(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  try {
    return Number(BigInt(trimmed) & 0xffffffffn) | 0;
  } catch {
    return null;
  }
}

function decodeScrambleHash(hash: string | undefined): number {
  switch (hash?.trim()) {
    case "03632":
      return 58414;
    case "02900":
      return 117532;
    default:
      return 0;
  }
}

// ---- Byte-XOR keystreams (pure Uint8Array transforms) ----

function decodeEncodedBytes(
  bytes: Uint8Array,
  seed: number,
  length: number,
  algo: string | undefined,
): Uint8Array {
  if (algo !== "2") {
    return decodeWithLcg(bytes, seed, length);
  }

  const candidates = [
    decodeWithXorshift(bytes, seed | 1, length, false),
    decodeWithXorshift(bytes, seed, length, false),
    decodeWithXorshift(bytes, seed | 1, length, true),
    decodeWithLcg(bytes, seed, length),
  ];
  return candidates.find((c) => hasImageSignature(c)) ?? candidates[0];
}

function decodeWithXorshift(
  bytes: Uint8Array,
  initialState: number,
  length: number,
  highByte: boolean,
): Uint8Array {
  const result = bytes.slice();
  let state = initialState | 0;
  const limit = Math.min(result.length, length);
  for (let i = 0; i < limit; i++) {
    state = nextXorshiftState(state);
    const key = highByte ? state >>> 24 : state & 0xff;
    result[i] = result[i] ^ key;
  }
  return result;
}

function decodeWithLcg(
  bytes: Uint8Array,
  seed: number,
  length: number,
): Uint8Array {
  const result = bytes.slice();
  let state = seed | 0;
  const limit = Math.min(result.length, length);
  for (let i = 0; i < limit; i++) {
    // 32-bit signed: state = state * ENC_MULTIPLIER + ENC_INCREMENT
    state = (Math.imul(state, ENC_MULTIPLIER) + ENC_INCREMENT) | 0;
    result[i] = result[i] ^ (state >>> 24);
  }
  return result;
}

function nextXorshiftState(state: number): number {
  let next = state | 0;
  next = next ^ (next << 13);
  next = next ^ (next >>> 17);
  next = next ^ (next << 5);
  return next | 0;
}

function hasImageSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  return isWebp || isJpeg || isPng;
}

// Detect the real image format from magic bytes so the canvas decoder gets the
// correct data: URL MIME. Returns undefined when no signature matches (e.g. the
// bytes are still XOR-encoded and will be handled before grid descramble).
function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  if (
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
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return undefined;
}

// "image/webp; charset=..." -> "image/webp"
function stripMimeParams(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const base = value.split(";")[0]?.trim().toLowerCase();
  return base && base.startsWith("image/") ? base : undefined;
}

// ---- 5x5 tile permutation ----

// Build the inverse permutation that maps each destination tile index to its
// source tile index, undoing the server-side Fisher–Yates shuffle.
function buildTileOrder(seed: number, algo: string | undefined): number[] {
  const arr: number[] = [];
  for (let i = 0; i < NUM_TILES; i++) arr.push(i);

  if (algo === "3") {
    let state = (seed | 1) | 0;
    for (let i = NUM_TILES - 1; i >= 1; i--) {
      state = state ^ (state << 13);
      state = state ^ (state >>> 17);
      state = state ^ (state << 5);
      state = state | 0;
      const j = Number((BigInt(state >>> 0) & 0xffffffffn) % BigInt(i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  } else {
    let state = seed | 0;
    for (let i = NUM_TILES - 1; i >= 1; i--) {
      state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) | 0;
      const j = Number((BigInt(state >>> 0) & 0xffffffffn) % BigInt(i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  const inverse = new Array<number>(NUM_TILES).fill(0);
  for (let i = 0; i < arr.length; i++) {
    inverse[arr[i]] = i;
  }
  return inverse;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export const Comix = new ComixExtension();
