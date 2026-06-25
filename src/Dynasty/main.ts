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

const BASE_URL = "https://dynasty-scans.com";

// Upstream type/directory constants
const SERIES_TYPE = "Series";
const CHAPTER_TYPE = "Chapter";
const ANTHOLOGY_TYPE = "Anthology";
const DOUJIN_TYPE = "Doujin";
const ISSUE_TYPE = "Issue";

const SERIES_DIR = "series";
const CHAPTERS_DIR = "chapters";
const ANTHOLOGIES_DIR = "anthologies";
const DOUJINS_DIR = "doujins";
const ISSUES_DIR = "issues";

const VALID_DIRS = [
  SERIES_DIR,
  CHAPTERS_DIR,
  ANTHOLOGIES_DIR,
  DOUJINS_DIR,
  ISSUES_DIR,
];

const CHAPTER_SLUG_REGEX = /(.*?)_(ch[0-9_]+|volume_[0-9_\w]+)/;
const UNICODE_REGEX = /\\u([0-9A-Fa-f]{4})/g;
const AUTHORS_UPPER_LIMIT = 15;

// Sentinel path used as the placeholder thumbnail URL for browse/search
// entries (whose JSON listing carries no cover). The interceptor resolves it
// to the real cover by fetching the entry's `.json`. Mirrors the upstream
// cover-fetch interceptor (COVER_FETCH_HOST) approach.
const COVER_FETCH_PATH = "/__pbcover__";

// Number of chapter-listing pages to fetch (upstream default is 2)
const CHAPTER_FETCH_LIMIT = 5;

interface DynastyMetadata {
  page?: number;
}

// ----------------------------------------------------------------
// JSON shapes (subset of the upstream Dto.kt)
// ----------------------------------------------------------------

interface BrowseTagJson {
  type?: string;
  name?: string;
  permalink?: string;
}

interface BrowseChapterJson {
  title?: string;
  permalink?: string;
  tags?: BrowseTagJson[];
}

interface BrowseResponseJson {
  chapters?: BrowseChapterJson[];
  current_page?: number;
  total_pages?: number;
}

interface MangaTaggingJson {
  header?: string;
  title?: string;
  permalink?: string;
  released_on?: string;
  tags?: BrowseTagJson[];
}

interface MangaResponseJson {
  name?: string;
  type?: string;
  permalink?: string;
  tags?: BrowseTagJson[];
  cover?: string;
  description?: string;
  aliases?: string[];
  taggings?: MangaTaggingJson[];
  total_pages?: number;
}

interface PageJson {
  url?: string;
}

interface ChapterResponseJson {
  title?: string;
  permalink?: string;
  tags?: BrowseTagJson[];
  pages?: PageJson[];
  released_on?: string;
}

// ----------------------------------------------------------------
// Module-level URL helpers (shared by the extension + interceptor)
// ----------------------------------------------------------------

function absoluteUrlStr(src: string): string {
  const s = (src || "").trim();
  if (!s) return "";
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
}

function buildCoverUrlStr(file: string): string {
  const abs = absoluteUrlStr(file);
  let path: string;
  try {
    path = new URL(abs).pathname.replace(/^\/+/, "");
  } catch {
    path = file.replace(/^\/+/, "");
  }
  if (path.startsWith("system/")) {
    return `${BASE_URL}/${path}`;
  }
  return `${BASE_URL}/system/tag_contents_covers/000/${path}`;
}

// The placeholder cover URL stored on browse/search items. The interceptor
// recognises it, fetches the entry JSON, and rewrites the request to the
// real cover image. directory + permalink are carried as query params.
function buildCoverFetchUrl(directory: string, permalink: string): string {
  return (
    `${BASE_URL}${COVER_FETCH_PATH}` +
    `?dir=${encodeURIComponent(directory)}` +
    `&permalink=${encodeURIComponent(permalink)}`
  );
}

class DynastyInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // Resolve placeholder cover URLs to the real image before the request
    // is sent. The listing JSON carries no cover, so we fetch the entry's
    // `.json` here and rewrite the URL to its cover / first page.
    if (request.url.includes(COVER_FETCH_PATH)) {
      const resolved = await this.resolveCoverUrl(request.url);
      if (resolved) {
        request.url = resolved;
      }
    }

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

  private async resolveCoverUrl(url: string): Promise<string | undefined> {
    let dir = "";
    let permalink = "";
    try {
      const u = new URL(url);
      dir = u.searchParams.get("dir") ?? "";
      permalink = u.searchParams.get("permalink") ?? "";
    } catch {
      return undefined;
    }
    if (!dir || !permalink) return undefined;

    const jsonUrl = `${BASE_URL}/${dir}/${encodeURIComponent(permalink)}.json`;
    try {
      const [response, data] = await Application.scheduleRequest({
        url: jsonUrl,
        method: "GET",
      });
      if (response.status !== 200) return undefined;
      const json = JSON.parse(Application.arrayBufferToUTF8String(data)) as {
        cover?: string;
        pages?: { url?: string }[];
      };
      const cover = json.cover ?? json.pages?.[0]?.url;
      if (!cover) return undefined;
      return buildCoverUrlStr(cover);
    } catch {
      return undefined;
    }
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

type DynastyImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class DynastyExtension implements DynastyImplementation {
  requestManager = new DynastyInterceptor("main");
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
        id: "added",
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id !== "added") {
      return { items: [], metadata: undefined };
    }

    // The homepage `/` is the "Recently Released Chapters" list and is the
    // only listing that embeds cover thumbnails inline (a single request).
    // Paperback's carousel image loader needs a real, direct image URL, so we
    // scrape the homepage rather than added.json (which carries no cover).
    // Paginated /chapters/added pages drop the covers, so the carousel is a
    // single page.
    const $ = await this.fetchCheerio({ url: `${BASE_URL}/`, method: "GET" });

    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    $("a.chapter.media.thumbnail").each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr("href") || "";
      if (!href || !href.includes(`/${CHAPTERS_DIR}/`)) return;

      const permalink = href.split(`/${CHAPTERS_DIR}/`)[1]?.split(/[?#]/)[0];
      if (!permalink) return;

      const mangaId = this.toSafeId(`${CHAPTERS_DIR}/${permalink}`);
      if (seen.has(mangaId)) return;
      seen.add(mangaId);

      const imageUrl = absoluteUrlStr(anchor.find("img").first().attr("src") || "");
      const title = anchor.find(".title").first().text().trim();
      if (!title) return;

      items.push({
        type: "simpleCarouselItem",
        mangaId,
        imageUrl,
        title,
        metadata: undefined,
      });
    });

    return { items, metadata: undefined };
  }

  private entriesFromBrowse(
    data: BrowseResponseJson,
  ): { mangaId: string; title: string; imageUrl: string }[] {
    const out: { mangaId: string; title: string; imageUrl: string }[] = [];

    for (const chapter of data.chapters ?? []) {
      let isSeries = false;

      for (const tag of chapter.tags ?? []) {
        const dir = this.directoryForType(tag.type);
        if (
          dir &&
          (tag.type === SERIES_TYPE ||
            tag.type === ANTHOLOGY_TYPE ||
            tag.type === DOUJIN_TYPE ||
            tag.type === ISSUE_TYPE)
        ) {
          out.push({
            mangaId: this.toSafeId(`${dir}/${tag.permalink ?? ""}`),
            title: tag.name ?? "",
            imageUrl: buildCoverFetchUrl(dir, tag.permalink ?? ""),
          });
          isSeries = isSeries || tag.type === SERIES_TYPE;
        }
      }

      if (!isSeries) {
        out.push({
          mangaId: this.toSafeId(`${CHAPTERS_DIR}/${chapter.permalink ?? ""}`),
          title: chapter.title ?? "",
          imageUrl: buildCoverFetchUrl(CHAPTERS_DIR, chapter.permalink ?? ""),
        });
      }
    }

    return out;
  }

  private directoryForType(type: string | undefined): string | undefined {
    switch (type) {
      case SERIES_TYPE:
        return SERIES_DIR;
      case ANTHOLOGY_TYPE:
        return ANTHOLOGIES_DIR;
      case DOUJIN_TYPE:
        return DOUJINS_DIR;
      case ISSUE_TYPE:
        return ISSUES_DIR;
      default:
        return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Search (HTML result page)
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as DynastyMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    // Deep-link support: a full dynasty-scans URL pasted as the search query.
    if (titleQuery.startsWith("https://") || titleQuery.startsWith("http://")) {
      const item = this.deepLinkItem(titleQuery);
      return { items: item ? [item] : [], metadata: undefined };
    }

    const params: string[] = [];
    params.push(`q=${encodeURIComponent(titleQuery)}`);
    params.push(`sort=${titleQuery ? "" : "released_on"}`);
    for (const type of [
      SERIES_TYPE,
      CHAPTER_TYPE,
      ANTHOLOGY_TYPE,
      DOUJIN_TYPE,
      ISSUE_TYPE,
    ]) {
      params.push(`classes[]=${encodeURIComponent(type)}`);
    }
    if (page > 1) params.push(`page=${page}`);

    const url = `${BASE_URL}/search?${params.join("&")}`;
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    // NOTE: the upstream Jsoup selector uses `[href~=/(series|...)/]` where
    // `~=` is Jsoup's REGEX-match operator. In cheerio `~=` means a
    // whitespace-separated word match, so that selector matches nothing. We
    // instead select the anchors broadly and filter the href with a regex.
    const hrefRegex = new RegExp(
      `/(${SERIES_DIR}|${ANTHOLOGIES_DIR}|${CHAPTERS_DIR}|${DOUJINS_DIR}|${ISSUES_DIR})/`,
    );
    const selector =
      ".chapter-list a.name, .chapter-list .doujin_tags a[href]";

    $(selector).each((_, element) => {
      const el = $(element);
      const href = el.attr("href") || "";
      if (!hrefRegex.test(href)) return;
      const parsed = this.parseDirAndPermalink(href);
      if (!parsed) return;

      let { directory, permalink } = parsed;
      let title = el.text().trim();

      if (directory === CHAPTERS_DIR) {
        const m = permalink.match(CHAPTER_SLUG_REGEX);
        if (m && m[1]) {
          directory = SERIES_DIR;
          permalink = m[1];
          title = this.permalinkToTitle(permalink);
        }
      }

      const mangaId = this.toSafeId(`${directory}/${permalink}`);
      if (seen.has(mangaId)) return;
      seen.add(mangaId);

      results.push({
        mangaId,
        imageUrl: buildCoverFetchUrl(directory, permalink),
        title,
        subtitle: undefined,
        metadata: undefined,
      });
    });

    const hasNextPage = $(".pagination [rel=next]").length > 0;
    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private deepLinkItem(rawUrl: string): SearchResultItem | undefined {
    const parsed = this.parseDirAndPermalink(rawUrl);
    if (!parsed) return undefined;

    let { directory, permalink } = parsed;
    if (directory === CHAPTERS_DIR) {
      const m = permalink.match(CHAPTER_SLUG_REGEX);
      if (m && m[1]) {
        directory = SERIES_DIR;
        permalink = m[1];
      }
    }

    return {
      mangaId: this.toSafeId(`${directory}/${permalink}`),
      imageUrl: buildCoverFetchUrl(directory, permalink),
      title: this.permalinkToTitle(permalink),
      subtitle: undefined,
      metadata: undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { directory, permalink } = this.parseMangaId(mangaId);

    if (directory === CHAPTERS_DIR) {
      return this.chapterAsManga(mangaId, permalink);
    }

    const url = `${BASE_URL}/${directory}/${encodeURIComponent(permalink)}.json`;
    const data = await this.fetchJson<MangaResponseJson>(url);

    const authors = new Set<string>();
    const genres = new Set<string>();
    const publishingStatus = new Set<string>();
    const otherSections: { title: string; values: string[] }[] = [];
    const otherMap = new Map<string, string[]>();

    const pushOther = (type: string, name: string) => {
      const arr = otherMap.get(type) ?? [];
      arr.push(name);
      otherMap.set(type, arr);
    };

    for (const tag of data.tags ?? []) {
      const type = tag.type ?? "";
      const name = tag.name ?? "";
      if (type === "Author") authors.add(name);
      else if (type === "General") genres.add(name);
      else if (type === "Status") {
        publishingStatus.add(name);
        pushOther(type, name);
      } else if (type) pushOther(type, name);
    }

    for (const tagging of data.taggings ?? []) {
      if (tagging.header !== undefined && tagging.title === undefined) continue;
      for (const tag of tagging.tags ?? []) {
        const type = tag.type ?? "";
        const name = tag.name ?? "";
        if (type === "Author") authors.add(name);
        else if (type === "General") genres.add(name);
        else if (
          type === SERIES_TYPE ||
          type === DOUJIN_TYPE ||
          type === ANTHOLOGY_TYPE ||
          type === ISSUE_TYPE ||
          type === "Scanlator"
        ) {
          // skip
        } else if (type) pushOther(type, name);
      }
    }

    for (const [type, values] of otherMap) {
      otherSections.push({ title: type, values });
    }

    const authorList = Array.from(authors);
    const authorStr =
      authorList.length > AUTHORS_UPPER_LIMIT
        ? authorList.slice(0, AUTHORS_UPPER_LIMIT).join(", ") + "..."
        : authorList.join(", ");

    const synopsis = this.buildSynopsis(data, otherSections);

    const tagGroups: TagSection[] = [];
    const genreList = Array.from(genres);
    if (genreList.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreList.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: data.name ?? this.permalinkToTitle(permalink),
        secondaryTitles: data.aliases ?? [],
        thumbnailUrl: data.cover
          ? this.buildCoverUrl(data.cover)
          : buildCoverFetchUrl(directory, permalink),
        author: authorStr || undefined,
        artist: authorStr || undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(publishingStatus),
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  private buildSynopsis(
    data: MangaResponseJson,
    otherSections: { title: string; values: string[] }[],
  ): string {
    const parts: string[] = [];

    if (data.description) {
      const decoded = this.decodeUnicode(data.description);
      const $ = cheerio.load(decoded);
      $("a").remove();
      const text = $.root().text().trim();
      if (text) parts.push(text);
    }

    parts.push(`Type: ${data.type ?? ""}`);

    for (const section of otherSections) {
      const lines = [`${section.title}:`];
      for (const v of section.values) lines.push(`• ${v}`);
      parts.push(lines.join("\n"));
    }

    if ((data.aliases ?? []).length > 0) {
      const lines = ["Aliases:"];
      for (const a of data.aliases ?? []) lines.push(`• ${a}`);
      parts.push(lines.join("\n"));
    }

    return parts.join("\n\n").trim();
  }

  private async chapterAsManga(
    mangaId: string,
    permalink: string,
  ): Promise<SourceManga> {
    const url = `${BASE_URL}/${CHAPTERS_DIR}/${encodeURIComponent(permalink)}.json`;
    const data = await this.fetchJson<ChapterResponseJson>(url);

    const authors = new Set<string>();
    const genres = new Set<string>();
    const otherMap = new Map<string, string[]>();

    for (const tag of data.tags ?? []) {
      const type = tag.type ?? "";
      const name = tag.name ?? "";
      if (type === "Author") authors.add(name);
      else if (type === "General") genres.add(name);
      else if (type) {
        const arr = otherMap.get(type) ?? [];
        arr.push(name);
        otherMap.set(type, arr);
      }
    }

    const synopsisParts: string[] = [`Type: ${CHAPTER_TYPE}`];
    for (const [type, values] of otherMap) {
      const lines = [`${type}:`];
      for (const v of values) lines.push(`• ${v}`);
      synopsisParts.push(lines.join("\n"));
    }
    if (data.released_on) synopsisParts.push(`Released: ${data.released_on}`);

    const firstPage = data.pages?.[0]?.url;
    const tagGroups: TagSection[] = [];
    const genreList = Array.from(genres);
    if (genreList.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: genreList.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: data.title ?? this.permalinkToTitle(permalink),
        secondaryTitles: [],
        thumbnailUrl: firstPage
          ? this.buildCoverUrl(firstPage)
          : buildCoverFetchUrl(CHAPTERS_DIR, permalink),
        author: Array.from(authors).join(", ") || undefined,
        artist: Array.from(authors).join(", ") || undefined,
        synopsis: synopsisParts.join("\n\n").trim(),
        contentRating: ContentRating.MATURE,
        status: "Completed",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { directory, permalink } = this.parseMangaId(sourceManga.mangaId);

    if (directory === CHAPTERS_DIR) {
      return [
        {
          chapterId: this.toSafeId(`${CHAPTERS_DIR}/${permalink}`),
          sourceManga,
          title: "Chapter",
          volume: 0,
          chapNum: 1,
          publishDate: new Date(0),
          langCode: "🇬🇧",
        },
      ];
    }

    const baseJsonUrl = `${BASE_URL}/${directory}/${encodeURIComponent(permalink)}.json`;
    const data = await this.fetchJson<MangaResponseJson>(baseJsonUrl);

    const taggings: MangaTaggingJson[] = [...(data.taggings ?? [])];
    const totalPages = data.total_pages ?? 1;
    let page = 2;
    while (page <= totalPages && page <= CHAPTER_FETCH_LIMIT) {
      const pageData = await this.fetchJson<MangaResponseJson>(
        `${baseJsonUrl}?page=${page}`,
      );
      taggings.push(...(pageData.taggings ?? []));
      page += 1;
    }

    const isSeries = data.type === SERIES_TYPE;
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    let header: string | undefined;

    for (const item of taggings) {
      if (item.header !== undefined && item.title === undefined) {
        header = item.header ?? undefined;
        continue;
      }
      if (!item.permalink) continue;

      let chapterName = header ? `${header} ${item.title ?? ""}` : item.title ?? "";
      if (!isSeries) {
        const itemAuthors = (item.tags ?? [])
          .filter((t) => t.type === "Author")
          .map((t) => t.name ?? "");
        if (itemAuthors.length > 0) {
          chapterName += ` by ${itemAuthors.join(" and ")}`;
        }
      }

      const chapterId = this.toSafeId(`${CHAPTERS_DIR}/${item.permalink}`);
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      chapters.push({
        chapterId,
        sourceManga,
        title: chapterName.trim(),
        volume: 0,
        chapNum: 0,
        publishDate: this.parseDate(item.released_on),
        langCode: "🇬🇧",
      });
    }

    const ordered = data.type !== DOUJIN_TYPE ? chapters.reverse() : chapters;
    return ordered.map((c, index) => ({ ...c, chapNum: index + 1 }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { permalink } = this.parseMangaId(chapter.chapterId);
    const url = `${BASE_URL}/${CHAPTERS_DIR}/${encodeURIComponent(permalink)}.json`;
    const data = await this.fetchJson<ChapterResponseJson>(url);

    const pages: string[] = [];
    for (const page of data.pages ?? []) {
      if (page.url) pages.push(this.absoluteUrl(page.url));
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

  private parseMangaId(mangaId: string): {
    directory: string;
    permalink: string;
  } {
    const decoded = this.safeDecode(mangaId).replace(/^\/+/, "");
    const idx = decoded.indexOf("/");
    if (idx < 0) {
      return { directory: SERIES_DIR, permalink: decoded };
    }
    const directory = decoded.slice(0, idx);
    const permalink = decoded.slice(idx + 1).replace(/\/+$/, "");
    return { directory, permalink };
  }

  private parseDirAndPermalink(
    href: string,
  ): { directory: string; permalink: string } | undefined {
    const cleaned = this.safeDecode(href)
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    const path = cleaned.startsWith("http")
      ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
      : cleaned.replace(/^\/+/, "");
    const segments = path.split("/").filter((s) => s.length > 0);
    if (segments.length < 2) return undefined;
    const directory = segments[0];
    const permalink = segments[1];
    if (!VALID_DIRS.includes(directory)) return undefined;
    return { directory, permalink };
  }

  private mangaUrl(mangaId: string): string {
    const slug = this.safeDecode(mangaId);
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

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  private buildCoverUrl(file: string): string {
    const abs = this.absoluteUrl(file);
    let path: string;
    try {
      path = new URL(abs).pathname.replace(/^\/+/, "");
    } catch {
      path = file.replace(/^\/+/, "");
    }
    if (path.startsWith("system/")) {
      return `${BASE_URL}/${path}`;
    }
    return `${BASE_URL}/system/tag_contents_covers/000/${path}`;
  }

  private parseStatus(publishingStatus: Set<string>): string {
    if (publishingStatus.has("Ongoing")) return "Ongoing";
    if (publishingStatus.has("Completed")) return "Completed";
    if (publishingStatus.has("On Hiatus")) return "Hiatus";
    if (publishingStatus.has("Licensed")) return "Completed";
    for (const s of ["Dropped", "Cancelled", "Not Updated", "Abandoned", "Removed"]) {
      if (publishingStatus.has(s)) return "Cancelled";
    }
    return "Unknown";
  }

  private parseDate(released: string | undefined): Date {
    if (!released) return new Date(0);
    const m = released.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return new Date(0);
    const d = new Date(
      Date.UTC(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
      ),
    );
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  private permalinkToTitle(permalink: string): string {
    return permalink
      .split("_")
      .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ");
  }

  private decodeUnicode(input: string): string {
    return input.replace(UNICODE_REGEX, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
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

  private async fetchJson<T>(url: string): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    return JSON.parse(Application.arrayBufferToUTF8String(data)) as T;
  }
}

export const Dynasty = new DynastyExtension();
