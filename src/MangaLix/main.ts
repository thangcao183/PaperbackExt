import {
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
  Tag,
  TagSection,
} from "@paperback/types";

const BASE_URL = "https://mangalix.com";
const DOMAIN = "mangalix.com";
const CHAPTERS_URL = `${BASE_URL}/chapters.json.gz`;
const CATALOG_START_REGEX = /\[\{id\s*:/g;
const CHAPTERS_CACHE_TTL_MS = 30 * 60 * 1000;

// Image host shortcodes used in the chapter page arrays.
const IMAGE_HOST_MAP: Record<string, string> = {
  $TEMP: "https://temp.compsci88.com",
  $HOT: "https://scans-hot.planeptune.us",
  $LST: "https://scans.lastation.us",
  $LOW: "https://official.lowee.us",
  $MFK: "https://images.mangafreak.me",
};

interface MangaDto {
  slug?: string;
  title?: string;
  description?: string;
  coverImage?: string;
  author?: string;
  status?: string;
  rating?: number;
  releaseYear?: number;
  genres?: string[];
  latestChapter?: { releaseDate?: string };
}

interface ChapterDto {
  id?: string;
  number?: number;
  title?: string;
  releaseDate?: string;
  pages?: string[];
}

class MangaLixInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
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
        method: request.method,
        headers: request.headers,
      });
    }
    return data;
  }
}

export class MangaLixExtension
  implements
    Extension,
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    CloudflareBypassRequestProviding
{
  requestManager = new MangaLixInterceptor("mangalixInterceptor");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  private catalogCache: MangaDto[] | null = null;
  private chaptersCache: Record<string, ChapterDto[]> | null = null;
  private chaptersFetchedAt = 0;

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
  }

  // === Discover ===

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular",
        title: "Popular",
        type: DiscoverSectionType.simpleCarousel,
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
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const catalog = await this.loadCatalog();
    let list = catalog;
    if (section.id === "latest") {
      list = catalog
        .slice()
        .sort((a, b) => this.latestTimestamp(b) - this.latestTimestamp(a));
    }
    const items: DiscoverSectionItem[] = list.map((m) => ({
      type: "simpleCarouselItem",
      mangaId: this.toSafeId(m.slug ?? ""),
      title: m.title ?? "",
      imageUrl: this.resolveCover(m.coverImage),
    }));
    return { items, metadata: undefined };
  }

  // === Search ===

  async getSearchResults(query: SearchQuery<Metadata>): Promise<PagedResults<SearchResultItem>> {
    const catalog = await this.loadCatalog();
    const terms = (query.title ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((t: string) => t.length > 0);

    const filtered =
      terms.length === 0
        ? catalog
        : catalog.filter((m) => {
            const haystack =
              `${m.title ?? ""} ${m.author ?? ""} ${m.slug ?? ""}`.toLowerCase();
            return terms.every((t: string) => haystack.includes(t));
          });

    const items: SearchResultItem[] = filtered.map((m) => ({
      mangaId: this.toSafeId(m.slug ?? ""),
      title: m.title ?? "",
      imageUrl: this.resolveCover(m.coverImage),
    }));
    return { items, metadata: undefined };
  }

  // === Manga details ===

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const slug = this.safeDecode(mangaId);
    const catalog = await this.loadCatalog();
    const dto = catalog.find((m) => m.slug === slug);

    const tags: Tag[] = (dto?.genres ?? [])
      .filter((g) => g && g.trim().length > 0)
      .map((g) => ({ id: g.toLowerCase().replace(/\s+/g, "-"), title: g }));
    const tagGroups: TagSection[] =
      tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: dto?.title ?? slug,
        secondaryTitles: [],
        thumbnailUrl: this.resolveCover(dto?.coverImage),
        synopsis: dto?.description ?? "",
        author: dto?.author || undefined,
        status: this.parseStatus(dto?.status),
        contentRating: ContentRating.MATURE,
        tagGroups,
        shareUrl: `${BASE_URL}/manga/${slug}`,
      },
    };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/manga/${this.safeDecode(mangaId)}`;
  }

  // === Chapters ===

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = this.safeDecode(sourceManga.mangaId);
    const all = await this.loadChapters();
    const list = all[slug] ?? [];

    return list.map((c) => {
      const num = c.number ?? 0;
      const numStr = String(num).replace(/\.0$/, "");
      return {
        chapterId: this.toSafeId(`${slug}#${c.id ?? numStr}#${numStr}`),
        title: c.title && c.title.trim().length > 0 ? c.title : `Chapter ${numStr}`,
        chapNum: num,
        publishDate: this.parseDate(c.releaseDate),
        sourceManga,
        langCode: "🇬🇧",
      };
    });
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = this.safeDecode(chapter.chapterId);
    const [slug, chapId] = decoded.split("#");
    const all = await this.loadChapters();
    const list = all[slug] ?? [];
    const dto =
      list.find((c) => (c.id ?? "") === chapId) ??
      list.find((c) => (c.number ?? 0) === chapter.chapNum);

    const pages = (dto?.pages ?? []).map((p) => this.resolveImageUrl(p));
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // === Cloudflare bypass ===

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      this.cookieStorageInterceptor.deleteCookie(cookie);
    }
    const now = Date.now();
    for (const cookie of cookies) {
      if (!cookie.expires || cookie.expires.getTime() > now) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  // === Catalog loading ===

  private async loadCatalog(): Promise<MangaDto[]> {
    if (this.catalogCache) return this.catalogCache;

    const homeHtml = await this.fetchString(BASE_URL);
    const scriptMatch = homeHtml.match(
      /<script[^>]*src=["']([^"']*assets\/main-[^"']*)["'][^>]*>/i,
    );
    if (!scriptMatch) throw new Error("MangaLix: could not locate catalog script");
    const scriptUrl = this.absoluteUrl(scriptMatch[1]);
    const scriptBody = await this.fetchString(scriptUrl);

    const candidates = this.extractCatalogCandidates(scriptBody);
    for (const candidate of candidates) {
      if (
        candidate.length > 0 &&
        candidate.every(
          (m) =>
            typeof m.slug === "string" &&
            m.slug.trim().length > 0 &&
            typeof m.title === "string" &&
            m.title.trim().length > 0,
        )
      ) {
        const seen = new Set<string>();
        const deduped: MangaDto[] = [];
        for (const m of candidate) {
          const key = m.slug as string;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(m);
          }
        }
        this.catalogCache = deduped;
        return deduped;
      }
    }
    throw new Error("MangaLix: no valid catalog found in script");
  }

  private extractCatalogCandidates(script: string): MangaDto[][] {
    const results: MangaDto[][] = [];
    CATALOG_START_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CATALOG_START_REGEX.exec(script)) !== null) {
      try {
        const parser = new JsLiteralParser(script, match.index);
        const value = parser.parseValue();
        if (Array.isArray(value)) {
          results.push(value as MangaDto[]);
        }
      } catch {
        // ignore malformed candidate, try next match
      }
    }
    return results;
  }

  private async loadChapters(): Promise<Record<string, ChapterDto[]>> {
    const now = Date.now();
    if (this.chaptersCache && now - this.chaptersFetchedAt < CHAPTERS_CACHE_TTL_MS) {
      return this.chaptersCache;
    }

    const [response, data] = await Application.scheduleRequest({
      url: CHAPTERS_URL,
      method: "GET",
      headers: {
        accept: "application/gzip",
        "accept-encoding": "identity",
      },
    });
    if (response.status === 404) {
      throw new Error(`MangaLix: chapters not found (${CHAPTERS_URL})`);
    }

    const bytes = new Uint8Array(data);
    // The endpoint returns a raw .gz file (Content-Type application/gzip with no
    // Content-Encoding header), so the platform does not auto-inflate it.
    const jsonStr = isGzip(bytes)
      ? utf8Decode(gunzip(bytes))
      : Application.arrayBufferToUTF8String(data);

    const parsed = JSON.parse(jsonStr) as Record<string, ChapterDto[]>;
    this.chaptersCache = parsed;
    this.chaptersFetchedAt = now;
    return parsed;
  }

  // === Helpers ===

  private latestTimestamp(m: MangaDto): number {
    const d = this.parseDate(m.latestChapter?.releaseDate);
    return d.getTime();
  }

  private resolveCover(cover?: string): string {
    if (!cover) return "";
    const trimmed = cover.trim();
    if (trimmed.startsWith("http")) return trimmed;
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    return `${BASE_URL}/${trimmed.replace(/^\/+/, "")}`;
  }

  private resolveImageUrl(raw: string): string {
    if (!raw) return "";
    let url = raw.trim();
    for (const [code, host] of Object.entries(IMAGE_HOST_MAP)) {
      if (url.startsWith(code)) {
        return host + url.slice(code.length);
      }
    }
    if (url.startsWith("/cdn-readmanga/")) {
      return `https://cdn.readmanga.cc${url.slice("/cdn-readmanga".length)}`;
    }
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `${BASE_URL}${url}`;
    return url;
  }

  private parseStatus(status?: string): string {
    const s = (status ?? "")
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (["ongoing", "publishing", "releasing", "active"].includes(s))
      return "Ongoing";
    if (["completed", "complete", "finished"].includes(s)) return "Completed";
    if (["hiatus", "on hiatus", "paused"].includes(s)) return "Hiatus";
    if (["cancelled", "canceled", "dropped", "axed", "discontinued"].includes(s))
      return "Cancelled";
    return "Unknown";
  }

  private parseDate(dateText?: string): Date {
    if (!dateText) return new Date(0);
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;
    return new Date(0);
  }

  private absoluteUrl(url: string): string {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `${BASE_URL}${url}`;
    return `${BASE_URL}/${url}`;
  }

  private toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) =>
      encodeURIComponent(c),
    );
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  private async fetchString(url: string): Promise<string> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
    });
    if (response.status === 404) {
      throw new Error(`MangaLix: not found (${url})`);
    }
    return Application.arrayBufferToUTF8String(data);
  }
}

// ============================================================================
// JS object-literal parser (recursive descent). Handles unquoted identifier
// keys, single/double-quoted strings with escapes, numbers, booleans, null and
// undefined, and trailing commas. Ported from the upstream JsLiteralParser.
// ============================================================================

type JsValue =
  | string
  | number
  | boolean
  | null
  | JsValue[]
  | { [key: string]: JsValue };

class JsLiteralParser {
  private src: string;
  private pos: number;

  constructor(src: string, start: number) {
    this.src = src;
    this.pos = start;
  }

  parseValue(): JsValue {
    this.skipWs();
    const c = this.src[this.pos];
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"' || c === "'") return this.parseString();
    if (c === "-" || c === "+" || (c >= "0" && c <= "9")) return this.parseNumber();
    return this.parseKeyword();
  }

  private parseObject(): { [key: string]: JsValue } {
    const obj: { [key: string]: JsValue } = {};
    this.expect("{");
    this.skipWs();
    if (this.src[this.pos] === "}") {
      this.pos++;
      return obj;
    }
    for (;;) {
      this.skipWs();
      let key: string;
      const c = this.src[this.pos];
      if (c === '"' || c === "'") {
        key = this.parseString();
      } else {
        key = this.parseIdentifier();
      }
      this.skipWs();
      this.expect(":");
      const value = this.parseValue();
      obj[key] = value;
      this.skipWs();
      const next = this.src[this.pos];
      if (next === ",") {
        this.pos++;
        this.skipWs();
        if (this.src[this.pos] === "}") {
          this.pos++;
          return obj;
        }
        continue;
      }
      if (next === "}") {
        this.pos++;
        return obj;
      }
      throw new Error(`JsLiteralParser: unexpected char '${next}' in object`);
    }
  }

  private parseArray(): JsValue[] {
    const arr: JsValue[] = [];
    this.expect("[");
    this.skipWs();
    if (this.src[this.pos] === "]") {
      this.pos++;
      return arr;
    }
    for (;;) {
      const value = this.parseValue();
      arr.push(value);
      this.skipWs();
      const next = this.src[this.pos];
      if (next === ",") {
        this.pos++;
        this.skipWs();
        if (this.src[this.pos] === "]") {
          this.pos++;
          return arr;
        }
        continue;
      }
      if (next === "]") {
        this.pos++;
        return arr;
      }
      throw new Error(`JsLiteralParser: unexpected char '${next}' in array`);
    }
  }

  private parseString(): string {
    const quote = this.src[this.pos];
    this.pos++;
    let out = "";
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === "\\") {
        this.pos++;
        const e = this.src[this.pos];
        switch (e) {
          case '"':
          case "'":
          case "\\":
          case "/":
            out += e;
            this.pos++;
            break;
          case "b":
            out += "\b";
            this.pos++;
            break;
          case "f":
            out += "\f";
            this.pos++;
            break;
          case "n":
            out += "\n";
            this.pos++;
            break;
          case "r":
            out += "\r";
            this.pos++;
            break;
          case "t":
            out += "\t";
            this.pos++;
            break;
          case "v":
            out += "\v";
            this.pos++;
            break;
          case "0":
            out += "\0";
            this.pos++;
            break;
          case "x": {
            this.pos++;
            const hex = this.src.substr(this.pos, 2);
            out += String.fromCharCode(parseInt(hex, 16));
            this.pos += 2;
            break;
          }
          case "u": {
            this.pos++;
            if (this.src[this.pos] === "{") {
              this.pos++;
              let hex = "";
              while (this.src[this.pos] !== "}") {
                hex += this.src[this.pos];
                this.pos++;
              }
              this.pos++; // consume }
              out += String.fromCodePoint(parseInt(hex, 16));
            } else {
              const hex = this.src.substr(this.pos, 4);
              out += String.fromCharCode(parseInt(hex, 16));
              this.pos += 4;
            }
            break;
          }
          case "\n":
            // line continuation
            this.pos++;
            break;
          default:
            out += e;
            this.pos++;
            break;
        }
      } else if (c === quote) {
        this.pos++;
        return out;
      } else {
        out += c;
        this.pos++;
      }
    }
    throw new Error("JsLiteralParser: unterminated string");
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.src[this.pos] === "-" || this.src[this.pos] === "+") this.pos++;
    while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos])) this.pos++;
    if (this.src[this.pos] === ".") {
      this.pos++;
      while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos]))
        this.pos++;
    }
    if (this.src[this.pos] === "e" || this.src[this.pos] === "E") {
      this.pos++;
      if (this.src[this.pos] === "-" || this.src[this.pos] === "+") this.pos++;
      while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos]))
        this.pos++;
    }
    return Number(this.src.slice(start, this.pos));
  }

  private parseKeyword(): JsValue {
    const id = this.parseIdentifier();
    if (id === "true") return true;
    if (id === "false") return false;
    if (id === "null" || id === "undefined") return null;
    return id;
  }

  private parseIdentifier(): string {
    const start = this.pos;
    while (
      this.pos < this.src.length &&
      /[A-Za-z0-9_$]/.test(this.src[this.pos])
    ) {
      this.pos++;
    }
    if (this.pos === start) {
      throw new Error(
        `JsLiteralParser: expected identifier at ${this.pos} ('${this.src[this.pos]}')`,
      );
    }
    return this.src.slice(start, this.pos);
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private expect(ch: string): void {
    if (this.src[this.pos] !== ch) {
      throw new Error(
        `JsLiteralParser: expected '${ch}' at ${this.pos} ('${this.src[this.pos]}')`,
      );
    }
    this.pos++;
  }
}

// ============================================================================
// Minimal pure-TS gzip/DEFLATE inflater (RFC 1951 + RFC 1952).
// ============================================================================

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function gunzip(bytes: Uint8Array): Uint8Array {
  // Parse gzip header (RFC 1952).
  if (!isGzip(bytes)) throw new Error("gunzip: not a gzip stream");
  let pos = 10; // ID1 ID2 CM FLG MTIME(4) XFL OS
  const flg = bytes[3];
  const FEXTRA = 0x04;
  const FNAME = 0x08;
  const FCOMMENT = 0x10;
  const FHCRC = 0x02;
  if (flg & FEXTRA) {
    const xlen = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2 + xlen;
  }
  if (flg & FNAME) {
    while (bytes[pos] !== 0) pos++;
    pos++;
  }
  if (flg & FCOMMENT) {
    while (bytes[pos] !== 0) pos++;
    pos++;
  }
  if (flg & FHCRC) {
    pos += 2;
  }
  return inflateRaw(bytes, pos);
}

// Fixed Huffman code lengths for literals/lengths.
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

interface HuffTree {
  counts: number[];
  symbols: number[];
}

function buildTree(lengths: number[], num: number): HuffTree {
  const counts = new Array(16).fill(0);
  for (let i = 0; i < num; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Array(16).fill(0);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Array(num).fill(0);
  for (let i = 0; i < num; i++) {
    if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  bytes: Uint8Array;
  pos: number;
  bitBuf = 0;
  bitCnt = 0;

  constructor(bytes: Uint8Array, pos: number) {
    this.bytes = bytes;
    this.pos = pos;
  }

  getBit(): number {
    if (this.bitCnt === 0) {
      this.bitBuf = this.bytes[this.pos++];
      this.bitCnt = 8;
    }
    const bit = this.bitBuf & 1;
    this.bitBuf >>= 1;
    this.bitCnt--;
    return bit;
  }

  getBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) val |= this.getBit() << i;
    return val;
  }

  alignByte(): void {
    this.bitCnt = 0;
  }

  decode(tree: HuffTree): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.getBit();
      const count = tree.counts[len];
      if (code - first < count) {
        return tree.symbols[index + (code - first)];
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("inflate: invalid Huffman code");
  }
}

function inflateRaw(bytes: Uint8Array, start: number): Uint8Array {
  const reader = new BitReader(bytes, start);
  const out: number[] = [];

  let fixedLit: HuffTree | null = null;
  let fixedDist: HuffTree | null = null;

  for (;;) {
    const bfinal = reader.getBit();
    const btype = reader.getBits(2);

    if (btype === 0) {
      // Stored block
      reader.alignByte();
      const len = reader.bytes[reader.pos] | (reader.bytes[reader.pos + 1] << 8);
      reader.pos += 4; // len + nlen
      for (let i = 0; i < len; i++) out.push(reader.bytes[reader.pos++]);
    } else {
      let litTree: HuffTree;
      let distTree: HuffTree;
      if (btype === 1) {
        if (!fixedLit) {
          const litLengths = new Array(288);
          for (let i = 0; i < 144; i++) litLengths[i] = 8;
          for (let i = 144; i < 256; i++) litLengths[i] = 9;
          for (let i = 256; i < 280; i++) litLengths[i] = 7;
          for (let i = 280; i < 288; i++) litLengths[i] = 8;
          fixedLit = buildTree(litLengths, 288);
          const distLengths = new Array(30).fill(5);
          fixedDist = buildTree(distLengths, 30);
        }
        litTree = fixedLit;
        distTree = fixedDist as HuffTree;
      } else if (btype === 2) {
        const hlit = reader.getBits(5) + 257;
        const hdist = reader.getBits(5) + 1;
        const hclen = reader.getBits(4) + 4;
        const clLengths = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) {
          clLengths[CODE_LENGTH_ORDER[i]] = reader.getBits(3);
        }
        const clTree = buildTree(clLengths, 19);
        const allLengths = new Array(hlit + hdist).fill(0);
        let i = 0;
        while (i < hlit + hdist) {
          const sym = reader.decode(clTree);
          if (sym < 16) {
            allLengths[i++] = sym;
          } else if (sym === 16) {
            const repeat = reader.getBits(2) + 3;
            const prev = allLengths[i - 1];
            for (let r = 0; r < repeat; r++) allLengths[i++] = prev;
          } else if (sym === 17) {
            const repeat = reader.getBits(3) + 3;
            for (let r = 0; r < repeat; r++) allLengths[i++] = 0;
          } else {
            const repeat = reader.getBits(7) + 11;
            for (let r = 0; r < repeat; r++) allLengths[i++] = 0;
          }
        }
        litTree = buildTree(allLengths.slice(0, hlit), hlit);
        distTree = buildTree(allLengths.slice(hlit), hdist);
      } else {
        throw new Error("inflate: invalid block type");
      }

      for (;;) {
        const sym = reader.decode(litTree);
        if (sym === 256) break;
        if (sym < 256) {
          out.push(sym);
        } else {
          const lenIdx = sym - 257;
          const length =
            LENGTH_BASE[lenIdx] + reader.getBits(LENGTH_EXTRA[lenIdx]);
          const distSym = reader.decode(distTree);
          const dist =
            DIST_BASE[distSym] + reader.getBits(DIST_EXTRA[distSym]);
          let from = out.length - dist;
          for (let k = 0; k < length; k++) {
            out.push(out[from++]);
          }
        }
      }
    }

    if (bfinal) break;
  }

  return new Uint8Array(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 < 0xe0) {
      const b1 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if (b0 < 0xf0) {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      const b3 = bytes[i++] & 0x3f;
      let cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

export const MangaLix = new MangaLixExtension();
