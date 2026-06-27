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

const BASE_URL = "https://roliascan.com";
const LANG = "en";

// How many API pages we aggregate per Paperback page. The upstream API
// returns chapter-level entries with blank URLs mixed in with actual manga
// entries, so we aggregate several API pages to fill a results page.
const API_PAGES_PER_PAGE = 5;
const API_PAGE_SIZE = 24;

// Genre name -> RoliaScan genre id (ported from the upstream source).
const ROLIA_TAGS: [string, number][] = [
  ["Action", 5],
  ["Adaptation", 49],
  ["Adapted to Manhua", 717],
  ["Adult Cast", 119],
  ["Adventure", 19],
  ["Aliens", 803],
  ["Animals", 240],
  ["Award Winning", 8],
  ["Childcare", 1146],
  ["Combat Sports", 358],
  ["Comedy", 61],
  ["Cooking", 266],
  ["Crime", 248],
  ["Crossdressing", 724],
  ["Delinquents", 228],
  ["Demons", 162],
  ["Detective", 150],
  ["Drama", 26],
  ["Ecchi", 117],
  ["Erotica", 202],
  ["Fantasy", 17],
  ["Full Color", 40],
  ["Gag Humor", 1068],
  ["Game", 1130],
  ["Gender Bender", 1190],
  ["Ghosts", 215],
  ["Gore", 187],
  ["Gourmet", 89],
  ["Harem", 47],
  ["Historical", 66],
  ["Horror", 67],
  ["Isekai", 55],
  ["Josei", 1062],
  ["Light Novel", 98],
  ["Long Strip", 41],
  ["Love Status Quo", 541],
  ["Mafia", 356],
  ["Magic", 45],
  ["Magical Sex Shift", 551],
  ["Manga", 97],
  ["Manhua", 35],
  ["Manhwa", 18],
  ["Martial Arts", 56],
  ["Mature", 404],
  ["Mecha", 396],
  ["Medical", 244],
  ["Military", 131],
  ["Monster Girls", 231],
  ["Monsters", 46],
  ["Music", 694],
  ["Mystery", 34],
  ["Mythology", 110],
  ["Ninja", 163],
  ["Office Workers", 505],
  ["Official Colored", 866],
  ["Organized Crime", 134],
  ["Otaku Culture", 570],
  ["Parody", 605],
  ["Philosophical", 912],
  ["Post-Apocalyptic", 241],
  ["Psychological", 149],
  ["Regression", 1131],
  ["Reincarnation", 29],
  ["Revenge", 964],
  ["Reverse Harem", 1085],
  ["Romance", 2],
  ["Romantic Subtext", 486],
  ["School", 14],
  ["School Life", 27],
  ["Sci-Fi", 33],
  ["Seinen", 105],
  ["Self-Published", 577],
  ["Sexual Violence", 536],
  ["Shoujo", 1071],
  ["Shounen", 11],
  ["Showbiz", 429],
  ["Slice of Life", 93],
  ["Smut", 742],
  ["Space", 206],
  ["Sports", 9],
  ["Streaming", 1132],
  ["Suggestive", 1116],
  ["Super Power", 6],
  ["Superhero", 865],
  ["Supernatural", 65],
  ["Survival", 236],
  ["Suspense", 287],
  ["Team Sports", 10],
  ["Thriller", 184],
  ["Time Travel", 37],
  ["Tragedy", 316],
  ["Transmigiration", 1133],
  ["Urban Fantasy", 120],
  ["Vampire", 209],
  ["Video Game", 277],
  ["Video Games", 616],
  ["Villainess", 355],
  ["Virtual Reality", 617],
  ["Web Comic", 48],
  ["Webtoon", 350],
  ["Workplace", 138],
  ["Wuxia", 68],
  ["Xianxia", 718],
  ["Zombies", 1115],
];

const RELATIVE_DATE_REGEX =
  /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/;

interface RoliaScanMetadata {
  page?: number;
}

interface BrowseManga {
  id: string;
  url: string;
  title: string;
  cover: string;
  type: string;
  description: string;
  status: string;
}

interface RenderedField {
  rendered: string;
}

interface MangaTerm {
  name: string;
  taxonomy: string;
}

interface MangaFeaturedMedia {
  source_url: string;
}

interface MangaEmbedded {
  "wp:featuredmedia"?: MangaFeaturedMedia[];
  "wp:term"?: MangaTerm[][];
}

interface MangaDetailsResponse {
  id: number;
  slug: string;
  title: RenderedField;
  content: RenderedField;
  type: string;
  _embedded?: MangaEmbedded;
}

interface ApiChapter {
  url: string;
  chapter: string;
  title?: string | null;
  date: string;
  group_name?: string | null;
  language: string;
}

interface ChapterListResponse {
  chapters: ApiChapter[];
}

interface PagesResponse {
  images: string[];
}

class RoliaScanInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json, text/javascript, */*; q=0.01",
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

type RoliaScanImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class RoliaScanExtension implements RoliaScanImplementation {
  requestManager = new RoliaScanInterceptor("main");
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
        title: "Popular",
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
      const items: DiscoverSectionItem[] = ROLIA_TAGS.map(([name, id]) => ({
        type: "genresCarouselItem",
        searchQuery: {
          title: "",
          metadata: { genre: id },
        },
        name,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as RoliaScanMetadata | undefined;
    const page = meta?.page ?? 1;
    const sort = section.id === "popular" ? "popular_desc" : "post_desc";

    const { mangas, hasNextPage } = await this.loadBrowsePage(page, {
      sort,
    });

    const items: DiscoverSectionItem[] = mangas.map((m) => ({
      type:
        section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem",
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      metadata: undefined,
    }));

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
    const meta = metadata as RoliaScanMetadata | undefined;
    const page = meta?.page ?? 1;
    const titleQuery = (query.title || "").trim();

    const queryMeta = query.metadata as { genre?: number } | undefined;
    const genre = queryMeta?.genre;

    const { mangas, hasNextPage } = await this.loadBrowsePage(page, {
      search: titleQuery,
      sort: "post_desc",
      genres: genre != null ? [genre] : [],
    });

    const items: SearchResultItem[] = mangas.map((m) => ({
      mangaId: m.mangaId,
      imageUrl: m.imageUrl,
      title: m.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    return {
      items,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { id, slug } = this.parseMangaId(mangaId);

    const url = `${BASE_URL}/wp-json/wp/v2/manga/${encodeURIComponent(
      id,
    )}?_embed`;
    const data = await this.fetchJson<MangaDetailsResponse>({
      url,
      method: "GET",
    });

    const title = this.unescapeHtml(data.title?.rendered ?? "") || slug;
    const synopsis = this.unescapeHtml(
      this.stripHtml(data.content?.rendered ?? ""),
    );

    const embedded = data._embedded ?? {};
    const thumbnailUrl =
      embedded["wp:featuredmedia"]?.[0]?.source_url ?? "";
    const author = this.getTerms(embedded, "manga_author").join(", ");

    const genres = new Set<string>(this.getTerms(embedded, "post_tag"));
    if (
      !["Manhwa", "Manhua", "Manga"].some((t) => genres.has(t)) &&
      data.type
    ) {
      genres.add(data.type);
    }

    const tagGroups: TagSection[] = [];
    const genreList = Array.from(genres).filter((g) => g.length > 0);
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
        primaryTitle: title,
        secondaryTitles: [],
        thumbnailUrl,
        author: author || undefined,
        artist: undefined,
        synopsis,
        contentRating: ContentRating.EVERYONE,
        status: "Unknown",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { id } = this.parseMangaId(sourceManga.mangaId);

    const timestamp = Math.floor(Date.now() / 1000);
    const token = this.md5(
      `${timestamp}mng_ch_${this.isoDate(new Date())}`,
    ).substring(0, 16);

    const url =
      `${BASE_URL}/auth/manga-chapters?` +
      `manga_id=${encodeURIComponent(id)}` +
      `&offset=0&limit=9999&order=DESC` +
      `&_t=${encodeURIComponent(token)}` +
      `&_ts=${timestamp}`;

    const data = await this.fetchJson<ChapterListResponse>({
      url,
      method: "GET",
    });

    const placeholders = new Set(["", "N/A", "—"]);
    const chapters: Chapter[] = [];

    for (const ch of data.chapters ?? []) {
      if (!ch.language || ch.language.toLowerCase() !== LANG) continue;

      let name = `Chapter ${ch.chapter}`;
      if (ch.title && !placeholders.has(ch.title)) {
        name += `: ${this.unescapeHtml(ch.title)}`;
      }

      chapters.push({
        chapterId: this.parsePath(ch.url),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: this.parseChapterNumber(ch.chapter),
        publishDate: this.parseRelativeDate(ch.date),
        langCode: "🇬🇧",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.chapterUrl(chapter.chapterId);
    const lastSegment = chapterUrl
      .split(/[?#]/)[0]
      .replace(/\/+$/, "")
      .split("/")
      .pop()!;
    const chapterId = lastSegment.substring(lastSegment.lastIndexOf("-") + 1);

    const url = `${BASE_URL}/auth/chapter-content?chapter_id=${encodeURIComponent(
      chapterId,
    )}`;
    const data = await this.fetchJson<PagesResponse>({ url, method: "GET" });

    const pages = (data.images ?? []).map((img) => this.absoluteUrl(img));

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
  // Browse API
  // ----------------------------------------------------------------

  private async loadBrowsePage(
    page: number,
    opts: { search?: string; sort: string; genres?: number[] },
  ): Promise<{
    mangas: { mangaId: string; imageUrl: string; title: string }[];
    hasNextPage: boolean;
  }> {
    const startApiPage = (page - 1) * API_PAGES_PER_PAGE + 1;
    const endApiPage = startApiPage + API_PAGES_PER_PAGE - 1;

    const mangas: { mangaId: string; imageUrl: string; title: string }[] = [];
    const seen = new Set<string>();
    let lastRawSize = 0;

    for (let apiPage = startApiPage; apiPage <= endApiPage; apiPage++) {
      const body = JSON.stringify({
        page: apiPage,
        search: opts.search?.trim() ?? "",
        years: this.stringifyList<number>([]),
        genres: this.stringifyList<number>(opts.genres ?? []),
        types: this.stringifyList<string>([]),
        statuses: this.stringifyList<string>([]),
        sort: opts.sort,
        genreMatchMode: "any",
      });

      const data = await this.fetchJson<BrowseManga[]>({
        url: `${BASE_URL}/wp-json/manga/v1/load`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      lastRawSize = data.length;

      for (const item of data) {
        if (item.type === "Novel" || !item.url || item.url.trim() === "") {
          continue;
        }
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        mangas.push({
          mangaId: this.buildMangaId(item.id, this.urlToSlug(item.url)),
          imageUrl: item.cover,
          title: this.unescapeHtml(item.title),
        });
      }

      if (data.length < API_PAGE_SIZE) break;
    }

    return { mangas, hasNextPage: lastRawSize === API_PAGE_SIZE };
  }

  // The upstream serialises list filter values as a JSON string primitive.
  private stringifyList<T>(values: T[]): string {
    return JSON.stringify(values);
  }

  // ----------------------------------------------------------------
  // Id helpers
  // ----------------------------------------------------------------

  private buildMangaId(id: string, slug: string): string {
    return this.toSafeId(`${id}#${slug}`);
  }

  private parseMangaId(mangaId: string): { id: string; slug: string } {
    const decoded = this.safeDecode(mangaId);
    const hashIndex = decoded.indexOf("#");
    if (hashIndex >= 0) {
      return {
        id: decoded.substring(0, hashIndex),
        slug: decoded.substring(hashIndex + 1),
      };
    }
    return { id: decoded, slug: decoded };
  }

  private mangaUrl(mangaId: string): string {
    const { slug } = this.parseMangaId(mangaId);
    return `${BASE_URL}/manga/${slug}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = this.safeDecode(chapterId);
    if (slug.startsWith("http")) return slug;
    return `${BASE_URL}/${slug.replace(/^\/+/, "")}`;
  }

  private urlToSlug(url: string): string {
    const cleaned = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const parts = cleaned
      .replace(/^https?:\/\/[^/]+/, "")
      .split("/")
      .filter((p) => p.length > 0);
    if (
      (parts.length === 2 && parts[0] === "manga") ||
      (parts.length === 3 && parts[0] === "read")
    ) {
      return parts[1];
    }
    // Fallback: last meaningful segment.
    return parts.length > 0 ? parts[parts.length - 1] : cleaned;
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

  private absoluteUrl(src: string): string {
    const s = (src || "").trim();
    if (!s) return "";
    if (s.startsWith("http")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    return s.startsWith("/") ? `${BASE_URL}${s}` : `${BASE_URL}/${s}`;
  }

  // ----------------------------------------------------------------
  // Parsing helpers
  // ----------------------------------------------------------------

  private getTerms(embedded: MangaEmbedded, type: string): string[] {
    const terms = embedded["wp:term"] ?? [];
    const group = terms.find((t) => t[0]?.taxonomy === type);
    return (group ?? []).map((t) => t.name);
  }

  private parseChapterNumber(chapter: string): number {
    const m = chapter.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private parseRelativeDate(value: string): Date {
    const m = value.match(RELATIVE_DATE_REGEX);
    if (!m) return new Date(0);

    const amount = parseInt(m[1], 10);
    const unit = m[2];
    const date = new Date();

    switch (unit) {
      case "second":
        date.setSeconds(date.getSeconds() - amount);
        break;
      case "minute":
        date.setMinutes(date.getMinutes() - amount);
        break;
      case "hour":
        date.setHours(date.getHours() - amount);
        break;
      case "day":
        date.setDate(date.getDate() - amount);
        break;
      case "week":
        date.setDate(date.getDate() - amount * 7);
        break;
      case "month":
        date.setMonth(date.getMonth() - amount);
        break;
      case "year":
        date.setFullYear(date.getFullYear() - amount);
        break;
    }

    return date;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>(?=\s*\S)/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private unescapeHtml(input: string): string {
    let decoded = input;
    let previous: string;
    do {
      previous = decoded;
      decoded = this.unescapeEntitiesOnce(decoded);
    } while (decoded !== previous);
    return decoded;
  }

  private unescapeEntitiesOnce(input: string): string {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
      hellip: "…",
      mdash: "—",
      ndash: "–",
      rsquo: "’",
      lsquo: "‘",
      rdquo: "”",
      ldquo: "“",
    };
    return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
      const e = body as string;
      if (e.startsWith("#x") || e.startsWith("#X")) {
        const code = parseInt(e.substring(2), 16);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      if (e.startsWith("#")) {
        const code = parseInt(e.substring(1), 10);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      return named[e] ?? match;
    });
  }

  // ----------------------------------------------------------------
  // Date / hashing helpers
  // ----------------------------------------------------------------

  // Format a date as "yyyyMMddHH" in UTC (matches upstream isoDateFormatter).
  private isoDate(date: Date): string {
    const pad = (n: number): string => n.toString().padStart(2, "0");
    return (
      `${date.getUTCFullYear()}` +
      `${pad(date.getUTCMonth() + 1)}` +
      `${pad(date.getUTCDate())}` +
      `${pad(date.getUTCHours())}`
    );
  }

  // Self-contained MD5 implementation (returns a lowercase hex digest).
  private md5(input: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0xd800 || code >= 0xe000) {
        bytes.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      } else {
        // Surrogate pair
        i++;
        const cp =
          0x10000 + (((code & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
      }
    }
    return this.md5Bytes(bytes);
  }

  private md5Bytes(bytes: number[]): string {
    const rotl = (x: number, c: number): number =>
      (x << c) | (x >>> (32 - c));
    const add = (a: number, b: number): number => (a + b) | 0;

    const s = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4,
      11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6,
      10, 15, 21,
    ];
    const K = [
      0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
      0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
      0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
      0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
      0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
      0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
      0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
      0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
      0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
      0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
      0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ];

    const msg = bytes.slice();
    const originalLengthBits = (msg.length * 8) >>> 0;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 0; i < 8; i++) {
      msg.push((originalLengthBits >>> (8 * i)) & 0xff);
    }

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let chunk = 0; chunk < msg.length; chunk += 64) {
      const M: number[] = [];
      for (let i = 0; i < 16; i++) {
        const j = chunk + i * 4;
        M[i] =
          msg[j] |
          (msg[j + 1] << 8) |
          (msg[j + 2] << 16) |
          (msg[j + 3] << 24);
      }

      let A = a0;
      let B = b0;
      let C = c0;
      let D = d0;

      for (let i = 0; i < 64; i++) {
        let F: number;
        let g: number;
        if (i < 16) {
          F = (B & C) | (~B & D);
          g = i;
        } else if (i < 32) {
          F = (D & B) | (~D & C);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          F = B ^ C ^ D;
          g = (3 * i + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = (7 * i) % 16;
        }
        F = add(add(add(F, A), K[i]), M[g]);
        A = D;
        D = C;
        C = B;
        B = add(B, rotl(F, s[i]));
      }

      a0 = add(a0, A);
      b0 = add(b0, B);
      c0 = add(c0, C);
      d0 = add(d0, D);
    }

    const toHex = (n: number): string => {
      let hex = "";
      for (let i = 0; i < 4; i++) {
        hex += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
      }
      return hex;
    };

    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
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

  private async fetchJson<T>(request: Request): Promise<T> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const text = Application.arrayBufferToUTF8String(data);
    return JSON.parse(text) as T;
  }
}

export const RoliaScan = new RoliaScanExtension();
