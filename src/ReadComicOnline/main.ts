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
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import * as htmlparser2 from "htmlparser2";
import {
  ReadComicOnlineSearchForm,
  ReadComicOnlineSearchMeta,
} from "./forms";
import {
  getMirrorBaseUrl,
  getQuality,
  getServer,
  ReadComicOnlineSettingsForm,
} from "./settings";

const CONFIG_URL =
  "https://raw.githubusercontent.com/keiyoushi/rco-script/refs/heads/main/decrypt.json";

interface ReadComicOnlineMetadata {
  page?: number;
}

interface RemoteConfig {
  imageDecryptEval: string;
  postDecryptEval: string | null;
  shouldVerifyLinks: boolean;
}

class ReadComicOnlineInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    request.headers = {
      ...request.headers,
      referer: `${baseUrl}/`,
      origin: baseUrl,
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

type ReadComicOnlineImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class ReadComicOnlineExtension
  implements ReadComicOnlineImplementation
{
  requestManager = new ReadComicOnlineInterceptor("main", () => this.baseUrl);
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private remoteConfig: RemoteConfig | undefined;

  get baseUrl(): string {
    return getMirrorBaseUrl();
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new ReadComicOnlineSettingsForm();
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

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: ReadComicOnlineSearchMeta }
      | undefined;
    return new ReadComicOnlineSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as ReadComicOnlineMetadata | undefined;
    const page = meta?.page ?? 1;
    const path = section.id === "latest" ? "LatestUpdate" : "MostPopular";
    const url = `${this.baseUrl}/ComicList/${path}?page=${page}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();
    this.eachListAnchor($).each((_i, el) => {
      const item = this.parseListItem($, $(el));
      if (item && !seen.has(item.mangaId)) {
        seen.add(item.mangaId);
        items.push({
          type:
            section.id === "latest"
              ? "simpleCarouselItem"
              : "featuredCarouselItem",
          mangaId: item.mangaId,
          imageUrl: item.imageUrl,
          title: item.title,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = this.hasNextPageLink($);
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
    const meta = metadata as ReadComicOnlineMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (query.metadata as { searchMeta?: ReadComicOnlineSearchMeta } | undefined)
      ?.searchMeta;

    const status = searchMeta?.status?.[0] ?? "";
    const sort = searchMeta?.sort?.[0] ?? "";
    const year = searchMeta?.year?.[0] ?? "";
    const includeGenres = searchMeta?.includeGenres ?? [];
    const excludeGenres = searchMeta?.excludeGenres ?? [];

    const hasFilters =
      status !== "" ||
      year !== "" ||
      includeGenres.length > 0 ||
      excludeGenres.length > 0;

    let url: string;
    if (titleQuery || hasFilters) {
      url =
        `${this.baseUrl}/AdvanceSearch?comicName=${encodeURIComponent(titleQuery)}` +
        `&page=${page}&status=${encodeURIComponent(status)}` +
        `&ig=${includeGenres.join(",")}&eg=${excludeGenres.join(",")}` +
        `&pubDate=${year}`;
    } else {
      const sortPath = sort ? `/${sort}` : "/MostPopular";
      url = `${this.baseUrl}/ComicList${sortPath}?page=${page}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const items: SearchResultItem[] = [];
    const seenSearch = new Set<string>();
    this.eachListAnchor($).each((_i, el) => {
      const item = this.parseListItem($, $(el));
      if (item && !seenSearch.has(item.mangaId)) {
        seenSearch.add(item.mangaId);
        items.push({
          mangaId: item.mangaId,
          imageUrl: item.imageUrl,
          title: item.title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    const hasNextPage = this.hasNextPageLink($);
    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Details / chapters
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetchCheerio({
      url: this.mangaUrl(mangaId),
      method: "GET",
    });

    // The site serves two distinct layouts depending on the user-agent. The
    // desktop layout (which keiyoushi targets) uses `div.barContent` with
    // `a.bigChar` + `.rightBox img`. iOS user-agents (which Paperback uses)
    // receive a mobile layout whose details live in `.col.info` / `.col.cover`
    // with the title in the page heading. Detect and support both.
    const desktopInfo = $("div.barContent").first();
    const isDesktop = desktopInfo.length > 0;
    const info = isDesktop ? desktopInfo : $(".col.info").first();

    const title = isDesktop
      ? info.find("a.bigChar").first().text().trim()
      : $(".content .heading h3").first().text().trim();

    const thumbnailUrl = this.absoluteUrl(
      (isDesktop
        ? $(".rightBox").first().find("img").first().attr("src")
        : $(".col.cover").first().find("img").first().attr("src")) ||
        $('link[rel="image_src"]').first().attr("href") ||
        $('meta[property="og:image"]').first().attr("content") ||
        "",
    );

    const author = this.summarizeList(this.infoLinks($, info, "Writer:"));
    const artist = this.summarizeList(this.infoLinks($, info, "Artist:"));

    const genres = this.infoLinks($, info, "Genres:");

    const descParts: string[] = [];
    const summaryP = this.infoParagraph($, info, "Summary:");
    let summary = summaryP
      ? summaryP
          .nextAll("p")
          .toArray()
          .map((p) => $(p).text().trim())
          .filter((t) => t.length > 0)
          .join("\n\n")
      : "";
    // Mobile layout has no "Summary:" label; the synopsis is a bare paragraph
    // in the `.section.group` block that follows the `.col.info` block.
    if (!summary && !isDesktop) {
      summary = $(".col.info")
        .first()
        .closest(".section.group")
        .nextAll(".section.group")
        .first()
        .text()
        .trim();
    }
    if (summary) descParts.push(summary);
    const publisher = this.infoParagraph($, info, "Publisher:")
      ?.text()
      .trim();
    if (publisher) descParts.push(publisher);
    const pubDate = this.infoParagraph($, info, "Publication date:")
      ?.text()
      .trim();
    if (pubDate) descParts.push(pubDate);

    const statusText =
      this.infoParagraph($, info, "Status:")?.text().trim() ?? "";

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
        author: author || undefined,
        artist: artist || undefined,
        synopsis: descParts.join("\n"),
        contentRating: ContentRating.EVERYONE,
        status: this.parseStatus(statusText),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetchCheerio({
      url: this.mangaUrl(sourceManga.mangaId),
      method: "GET",
    });

    const chapters: Chapter[] = [];
    // Desktop layout lists chapters in `table.listing`; the mobile layout
    // (served to iOS user-agents) uses `ul.list > li` with `.col-1 a` (link)
    // and `.col-2 span` (date). Support both.
    const tableRows = $("table.listing tr").toArray();
    if (tableRows.length > 0) {
      // `tr:gt(1)` / `td:eq(1)` are jQuery pseudo-classes unsupported by
      // Paperback's CSS engine; select all rows and slice/index in JS.
      const rows = tableRows.slice(2);
      rows.forEach((row, index) => {
        const link = $(row).find("a").first();
        const href = link.attr("href") || "";
        if (!href) return;
        const name = link.text().trim();
        const dateText = $(row).find("td").eq(1).text().trim();
        const parsedNum = this.parseChapterNumber(name);
        chapters.push({
          chapterId: this.parsePath(href),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: parsedNum >= 0 ? parsedNum : rows.length - index,
          publishDate: this.parseDate(dateText),
          langCode: "🇬🇧",
        });
      });
    } else {
      const rows = $("ul.list > li").toArray();
      rows.forEach((row, index) => {
        const link = $(row).find(".col-1 a").first();
        const href = link.attr("href") || "";
        if (!href) return;
        const name = link.text().trim();
        const dateText = $(row).find(".col-2").first().text().trim();
        const parsedNum = this.parseChapterNumber(name);
        chapters.push({
          chapterId: this.parsePath(href),
          sourceManga,
          title: name,
          volume: 0,
          chapNum: parsedNum >= 0 ? parsedNum : rows.length - index,
          publishDate: this.parseDate(dateText),
          langCode: "🇬🇧",
        });
      });
    }
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const quality = getQuality();
    const server = getServer();
    const chUrl = this.chapterUrl(chapter.chapterId);
    const separator = chUrl.includes("?") ? "&" : "?";
    const url = `${chUrl}${separator}s=${server}&quality=${quality}&readType=1`;

    // Fetch the chapter page WITHOUT stripping scripts (we need them for
    // decryption). Use a dedicated fetch that preserves scripts.
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Chapter not found");
    }
    const htmlStr = Application.arrayBufferToUTF8String(data);

    // Extract only inline scripts (skip external src= scripts which are
    // the bulky ad/tracking bundles that crash the parser). Use regex to
    // avoid parsing the full DOM.
    const scriptTexts: string[] = [];
    const scriptRegex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(htmlStr)) !== null) {
      const text = match[1].trim();
      if (text.length > 50) scriptTexts.push(text);
    }
    const combinedScripts = scriptTexts.join("\n");

    const useServer2 = server === "s2";
    const pages = await this.decryptPages(combinedScripts, useServer2);

    if (pages.length === 0) {
      throw new Error("No pages found. The page images could not be decrypted.");
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
  // Page decryption (remote-config JS eval via WebView)
  // ----------------------------------------------------------------

  private async getRemoteConfig(): Promise<RemoteConfig> {
    if (this.remoteConfig) return this.remoteConfig;
    const [, data] = await Application.scheduleRequest({
      url: `${CONFIG_URL}?bust=${Date.now()}`,
      method: "GET",
    });
    const parsed = JSON.parse(
      Application.arrayBufferToUTF8String(data),
    ) as RemoteConfig;
    this.remoteConfig = parsed;
    return parsed;
  }

  private async decryptPages(
    combinedScripts: string,
    useServer2: boolean,
  ): Promise<string[]> {
    const config = await this.getRemoteConfig();
    console.log(`[RCO] decrypt: scriptLen=${combinedScripts.length} useServer2=${useServer2}`);
    // Log what patterns the decrypt script expects to find
    const hasArray = /new\s+Array\(\)/.test(combinedScripts);
    const hasPush = /\.push\(/.test(combinedScripts);
    const hasBaeu = /baeu\(/.test(combinedScripts);
    const hasCurrImage = /currImage/.test(combinedScripts);
    console.log(`[RCO] patterns: Array=${hasArray} push=${hasPush} baeu=${hasBaeu} currImage=${hasCurrImage}`);
    // The decrypt script ends with `JSON.stringify(getCleanedLinks());` as a
    // bare expression. In an IIFE, we need to `return` it. Append `return`
    // before the last expression by wrapping with a return statement.
    const scriptBody =
      `var _encryptedString = ${JSON.stringify(combinedScripts)};\n` +
      `var _useServer2 = ${useServer2};\n` +
      config.imageDecryptEval;
    // The script's last statement is `JSON.stringify(...)` — wrap in a
    // function that returns the eval of the whole thing.
    const wrappedScript = `(function() { ${scriptBody.replace(
      /JSON\.stringify\(getCleanedLinks\(\)\);?\s*$/,
      "return JSON.stringify(getCleanedLinks());",
    )} })()`;

    try {
      const result = eval(wrappedScript) as string;
      console.log(`[RCO] eval result type: ${typeof result}, len: ${result?.length ?? 0}`);
      const parsed = JSON.parse(result) as string[];
      const filtered = parsed.filter((u) => typeof u === "string" && u.length > 0);
      console.log(`[RCO] decrypt result: ${filtered.length} pages`);
      if (filtered.length > 0) console.log(`[RCO] first page: ${filtered[0].substring(0, 100)}`);
      return filtered;
    } catch (e) {
      console.log(`[RCO] decrypt error: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Cover anchors for both the desktop (`.list-comic > .item`) and the
   * mobile (`.item-list .col.cover`) ComicList layouts. Mirrors like
   * rcostation.xyz serve the mobile template, whose markup differs entirely.
   */
  private eachListAnchor($: CheerioAPI): Cheerio<AnyNode> {
    const desktop = $(".list-comic > .item > a:first-child");
    if (desktop.length > 0) return desktop;
    return $(".item-list .col.cover > a");
  }

  private parseListItem(
    _$: CheerioAPI,
    a: Cheerio<AnyNode>,
  ): { mangaId: string; title: string; imageUrl: string } | undefined {
    const href = a.attr("href") || "";
    if (!href) return undefined;
    const img = a.find("img").first();
    // The desktop layout's anchor wraps the title text; the mobile layout's
    // cover anchor wraps only an <img>, so fall back to the image title/alt.
    const title =
      a.text().trim() ||
      (img.attr("title") || "").trim() ||
      (img.attr("alt") || "").trim();
    if (!title) return undefined;
    const imageUrl = this.absoluteUrl(
      img.attr("src") || img.attr("data-src") || "",
    );
    return { mangaId: this.parsePath(href), title, imageUrl };
  }

  private summarizeList(items: string[]): string {
    if (items.length === 0) return "";
    if (items.length > 2) return `${items[0]} & others`;
    return items.join(", ");
  }

  /**
   * Paperback's CSS engine rejects jQuery pseudo-classes (`:has`,
   * `:contains`, `:eq`, `:gt`). Find the info `<p>` whose `<span>` label
   * matches `label` by iterating in JS instead.
   */
  private infoParagraph(
    $: CheerioAPI,
    info: Cheerio<AnyNode>,
    label: string,
  ): Cheerio<AnyNode> | undefined {
    let match: Cheerio<AnyNode> | undefined;
    const want = label.toLowerCase();
    info.find("p").each((_i, p) => {
      if (match) return;
      const span = $(p).find("span").first();
      if (span.length > 0 && span.text().trim().toLowerCase().includes(want)) {
        match = $(p);
      }
    });
    return match;
  }

  /** Anchor texts inside the info paragraph for the given label. */
  private infoLinks(
    $: CheerioAPI,
    info: Cheerio<AnyNode>,
    label: string,
  ): string[] {
    const p = this.infoParagraph($, info, label);
    if (!p) return [];
    return p
      .find("a")
      .toArray()
      .map((a) => $(a).text().trim())
      .filter((t) => t.length > 0);
  }

  /** Detect a "Next" pagination link without `:contains()`. */
  private hasNextPageLink($: CheerioAPI): boolean {
    let found = false;
    $("ul.pager > li > a").each((_i, el) => {
      if (found) return;
      if ($(el).text().trim().toLowerCase().includes("next")) found = true;
    });
    return found;
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${this.baseUrl}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${this.baseUrl}/${slug.replace(/^\/+/, "")}`;
  }

  private parsePath(href: string): string {
    const decoded = this.safeDecode(href);
    const cleaned = decoded.replace(/#.*$/, "").replace(/\/+$/, "");
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
    const match = name.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : -1;
  }

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    return s.startsWith("/") ? `${this.baseUrl}${s}` : `${this.baseUrl}/${s}`;
  }

  private parseStatus(status: string): string {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing")) return "Ongoing";
    if (s.includes("completed")) return "Completed";
    return "Unknown";
  }

  private parseDate(dateText: string | undefined): Date {
    if (!dateText) return new Date(0);
    // Format MM/dd/yyyy
    const m = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
      if (!isNaN(d.getTime())) return d;
    }
    const fallback = new Date(dateText);
    return isNaN(fallback.getTime()) ? new Date(0) : fallback;
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
    let htmlStr = Application.arrayBufferToUTF8String(data);
    // The mobile mirror's pages are enormous (hundreds of KB of ad/tracking
    // scripts and inline styles). Parsing these with htmlparser2 crashes
    // Paperback's JSC engine. Strip <script> and <style> blocks before
    // parsing since we never need their content for details/chapters/lists.
    htmlStr = htmlStr.replace(/<script[\s\S]*?<\/script>/gi, "");
    htmlStr = htmlStr.replace(/<style[\s\S]*?<\/style>/gi, "");
    const dom = htmlparser2.parseDocument(htmlStr);
    return cheerio.load(dom);
  }
}

export const ReadComicOnline = new ReadComicOnlineExtension();
