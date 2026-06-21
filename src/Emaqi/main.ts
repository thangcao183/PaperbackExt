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

const BASE_URL = "https://emaqi.com";
const API_URL = "https://api.emaqi.com/graphql";

// ----------------------------------------------------------------
// GraphQL queries (ported verbatim from the upstream Kotlin source)
// ----------------------------------------------------------------

const SERIES_QUERY = `query FetchHomeSection($slug: String!, $mangaAfter: String) {
  homeSection(slug: $slug) {
    mangaConn(first: 40, after: $mangaAfter) {
      edges { node { comic { comicId slug title cover { url } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const GENRE_QUERY = `query FetchGenre($slug: String!, $mangaAfter: String) {
  genre(slug: $slug) {
    mangaConn(first: 40, after: $mangaAfter) {
      edges { node { comic { comicId slug title cover { url } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const SEARCH_QUERY = `query Search($input: SearchInput!) {
  search(input: $input) { comicId title slug cover { url } }
}`;

const DETAILS_QUERY = `query FetchMangaStatus($comicId: String!) {
  manga(comicId: $comicId) {
    comic {
      title synopsis rating creators publisher
      metadata { completed }
      cover { url }
      genres { ... on Tag { name } }
    }
  }
}`;

const CHAPTER_LIST_QUERY = `query FetchComicData($comicId: String!) {
  comicVolumes(comicId: $comicId) {
    volumes { comicId trialPage slug volumeNumber name price purchased free releasesAt }
  }
  chapters(comicId: $comicId) {
    comicId chapterNumber name purchased free releasesAt
  }
}`;

const CHAPTER_QUERY = `query FetchChapterContents($comicId: String!, $chapterNumber: Int!) {
  chapter(comicId: $comicId, chapterNumber: $chapterNumber) {
    contents { pages { url } hash }
  }
}`;

const VOLUME_QUERY = `query FetchMangaContents($comicId: String!, $volumeNumber: Int!) {
  manga(comicId: $comicId, volumeNumber: $volumeNumber) {
    contents { pages { url } hash }
  }
}`;

// Genres available for browsing (mirrors GenreFilter in the upstream source).
const GENRES: { name: string; slug: string }[] = [
  { name: "Shonen", slug: "shonen" },
  { name: "Shojo", slug: "shojo" },
  { name: "Seinen", slug: "seinen" },
  { name: "Kids", slug: "kids" },
  { name: "Josei", slug: "josei" },
  { name: "Artbook", slug: "artbook" },
  { name: "Free One-Shot", slug: "one-shot" },
  { name: "BL / Yaoi", slug: "bl" },
  { name: "Thriller", slug: "suspense" },
  { name: "Mystery", slug: "mystery" },
  { name: "Adventure", slug: "adventure" },
  { name: "Drama", slug: "drama" },
  { name: "GL / Yuri", slug: "yuri" },
  { name: "Sports", slug: "sports" },
  { name: "Food", slug: "food" },
  { name: "Sci-fi", slug: "sci-fi" },
  { name: "Isekai", slug: "isekai" },
  { name: "Action", slug: "action" },
  { name: "Fantasy", slug: "fantasy" },
  { name: "Horror", slug: "horror" },
  { name: "Romance", slug: "romance" },
  { name: "Comedy", slug: "comedy" },
  { name: "Death Game", slug: "death-game" },
  { name: "War", slug: "war" },
  { name: "Rom-com", slug: "rom-com" },
  { name: "Travel", slug: "travel" },
  { name: "Nature", slug: "nature" },
  { name: "Showbiz", slug: "showbiz" },
  { name: "Educational", slug: "educational" },
  { name: "Medical", slug: "medical" },
  { name: "Animal", slug: "animal" },
  { name: "Slice of Life", slug: "slice-of-life" },
  { name: "Supernatural", slug: "supernatural" },
  { name: "Art", slug: "art" },
  { name: "Gamble", slug: "gamble" },
  { name: "Depressing", slug: "depressing" },
  { name: "Professional", slug: "profession" },
  { name: "Survival", slug: "survival" },
  { name: "Hobby", slug: "hobby" },
  { name: "History", slug: "history" },
];

// ----------------------------------------------------------------
// JSON response shapes
// ----------------------------------------------------------------

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: { message?: string }[];
}

interface CoverNode {
  url?: string | null;
}

interface ComicNode {
  comicId: string;
  slug: string;
  title: string;
  cover?: CoverNode | null;
}

interface MangaConn {
  edges: { node: { comic: ComicNode } }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface SeriesData {
  homeSection?: { mangaConn: MangaConn } | null;
  genre?: { mangaConn: MangaConn } | null;
}

interface SearchData {
  search: ComicNode[];
}

interface DetailsData {
  manga: {
    comic: {
      title: string;
      synopsis?: string | null;
      rating?: number | null;
      creators?: string[] | null;
      publisher?: string | null;
      metadata?: { completed?: boolean | null } | null;
      cover?: CoverNode | null;
      genres?: { name?: string | null }[] | null;
    };
  };
}

interface ChapterEntry {
  comicId: string;
  chapterNumber?: number | null;
  name: string;
  purchased?: boolean | null;
  free?: boolean | null;
  releasesAt?: string | null;
}

interface VolumeEntry {
  comicId: string;
  trialPage?: number | null;
  slug: string;
  volumeNumber?: number | null;
  name: string;
  purchased?: boolean | null;
  free?: boolean | null;
  releasesAt?: string | null;
}

interface ChapterVolumeData {
  comicVolumes: { volumes: VolumeEntry[] };
  chapters: ChapterEntry[];
}

interface ViewerData {
  chapter?: { contents?: { pages: { url: string }[]; hash: string } | null } | null;
  manga?: { contents?: { pages: { url: string }[]; hash: string } | null } | null;
}

interface EmaqiSearchMetadata {
  page?: number;
  cursor?: string | null;
  genre?: string;
}

class EmaqiInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json, text/plain, */*",
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

    // Encrypted page images carry "<privateKeyB64Url>:<hashB64>" in the URL
    // fragment (see getChapterDetails). Mirror the upstream ImageInterceptor:
    // RSA-OAEP-decrypt the per-chapter AES key, then AES-GCM/CBC-decrypt the
    // image bytes. The GraphQL endpoint also has a "#..." fragment for paging,
    // so guard it out explicitly.
    const fragment = request.url.split("#").slice(1).join("#");
    if (
      !fragment ||
      !fragment.includes(":") ||
      request.url.startsWith(API_URL)
    ) {
      return data;
    }

    try {
      return await decryptImage(fragment, data);
    } catch {
      // Never throw out of interceptResponse: fall back to raw bytes.
      return data;
    }
  }
}

type EmaqiImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  DiscoverSectionProviding;

export class EmaqiExtension implements EmaqiImplementation {
  requestManager = new EmaqiInterceptor("main");
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
        id: "this-week-s-bestsellers",
        title: "This Week's Bestsellers",
        type: DiscoverSectionType.featured,
      },
      {
        id: "hot-release",
        title: "Hot Releases",
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
      const items: DiscoverSectionItem[] = GENRES.map((g) => ({
        type: "genresCarouselItem",
        name: g.name,
        searchQuery: {
          title: "",
          metadata: { genre: g.slug } as Metadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const meta = metadata as EmaqiSearchMetadata | undefined;
    const cursor = meta?.cursor ?? null;
    const data = await this.graphQL<SeriesData>(SERIES_QUERY, "FetchHomeSection", {
      slug: section.id,
      mangaAfter: cursor,
    });
    const conn = data.homeSection?.mangaConn;
    const items: DiscoverSectionItem[] = [];
    for (const edge of conn?.edges ?? []) {
      const comic = edge.node.comic;
      items.push({
        type:
          section.id === "this-week-s-bestsellers"
            ? "featuredCarouselItem"
            : "simpleCarouselItem",
        mangaId: this.buildMangaId(comic),
        imageUrl: comic.cover?.url ?? "",
        title: comic.title,
        metadata: undefined,
      });
    }

    const nextCursor =
      conn?.pageInfo.hasNextPage && conn.pageInfo.endCursor
        ? { cursor: conn.pageInfo.endCursor }
        : undefined;
    return { items, metadata: nextCursor };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    // Text search: single page of results, no pagination.
    if (titleQuery !== "") {
      const data = await this.graphQL<SearchData>(SEARCH_QUERY, "Search", {
        input: { keyword: titleQuery },
      });
      const items: SearchResultItem[] = (data.search ?? []).map((comic) => ({
        mangaId: this.buildMangaId(comic),
        imageUrl: comic.cover?.url ?? "",
        title: comic.title,
        subtitle: undefined,
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    // Empty query: browse by genre (cursor paginated).
    const queryGenre = (query.metadata as EmaqiSearchMetadata | undefined)?.genre;
    const pageMeta = metadata as EmaqiSearchMetadata | undefined;
    const genre = pageMeta?.genre ?? queryGenre ?? GENRES[0].slug;
    const cursor = pageMeta?.cursor ?? null;

    const data = await this.graphQL<SeriesData>(GENRE_QUERY, "FetchGenre", {
      slug: genre,
      mangaAfter: cursor,
    });
    const conn = data.genre?.mangaConn;
    const items: SearchResultItem[] = [];
    for (const edge of conn?.edges ?? []) {
      const comic = edge.node.comic;
      items.push({
        mangaId: this.buildMangaId(comic),
        imageUrl: comic.cover?.url ?? "",
        title: comic.title,
        subtitle: undefined,
        metadata: undefined,
      });
    }

    const nextMeta =
      conn?.pageInfo.hasNextPage && conn.pageInfo.endCursor
        ? { genre, cursor: conn.pageInfo.endCursor }
        : undefined;
    return { items, metadata: nextMeta };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { comicId } = this.parseMangaId(mangaId);
    const data = await this.graphQL<DetailsData>(
      DETAILS_QUERY,
      "FetchMangaStatus",
      { comicId },
    );
    const comic = data.manga.comic;

    const descriptionParts: string[] = [];
    if (comic.synopsis) descriptionParts.push(comic.synopsis);
    if (comic.publisher && comic.publisher.length > 0) {
      descriptionParts.push(`Publisher: ${comic.publisher}`);
    }
    if (comic.rating != null) {
      descriptionParts.push(`Age limit: ${comic.rating}+`);
    }
    const synopsis = descriptionParts.join("\n\n");

    const author = (comic.creators ?? []).join(", ");

    const genres = (comic.genres ?? [])
      .map((g) => g.name ?? "")
      .filter((name) => name.length > 0);
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
        primaryTitle: comic.title,
        secondaryTitles: [],
        thumbnailUrl: comic.cover?.url ?? "",
        author: author.length > 0 ? author : undefined,
        artist: author.length > 0 ? author : undefined,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: comic.metadata?.completed === true ? "Completed" : "Ongoing",
        tagGroups,
        shareUrl: this.mangaUrl(mangaId),
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { comicId, slug } = this.parseMangaId(sourceManga.mangaId);
    const data = await this.graphQL<ChapterVolumeData>(
      CHAPTER_LIST_QUERY,
      "FetchComicData",
      { comicId },
    );

    const chapters: Chapter[] = [];

    const singles = (data.chapters ?? []).map((c) =>
      this.chapterFromEntry(sourceManga, c, slug),
    );
    // Upstream reverses each list so newest is first.
    singles.reverse();
    chapters.push(...singles);

    const volumes = (data.comicVolumes?.volumes ?? []).map((v) =>
      this.volumeFromEntry(sourceManga, v, slug),
    );
    volumes.reverse();
    chapters.push(...volumes);

    return chapters;
  }

  private chapterFromEntry(
    sourceManga: SourceManga,
    c: ChapterEntry,
    slug: string,
  ): Chapter {
    const locked = c.purchased === false && c.free === false;
    const lock = locked ? "🔒 " : "";
    const chapNum = c.chapterNumber ?? -1;
    return {
      chapterId: `${c.comicId}/chapter/${chapNum}/${slug}`,
      sourceManga,
      title: lock + c.name,
      volume: 0,
      chapNum,
      publishDate: this.parseDate(c.releasesAt),
      langCode: "🇬🇧",
    };
  }

  private volumeFromEntry(
    sourceManga: SourceManga,
    v: VolumeEntry,
    urlSlug: string,
  ): Chapter {
    const locked = v.purchased === false && v.free === false;
    const isPreview = locked && v.trialPage != null && v.trialPage > 0;
    const lock = locked ? "🔒 " : "";
    const preview = isPreview ? "(Preview) " : "";
    const volNum = v.volumeNumber ?? -1;
    return {
      chapterId: `${v.comicId}/volume/${volNum}/${urlSlug}/${v.slug}`,
      sourceManga,
      title: lock + preview + v.name,
      volume: 0,
      chapNum: volNum,
      publishDate: this.parseDate(v.releasesAt),
      langCode: "🇬🇧",
    };
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const parts = this.safeDecode(chapter.chapterId).split("/");
    const comicId = parts[0] ?? "";
    const type = parts[1] ?? "";
    const number = parseInt(parts[2] ?? "0", 10);

    // Generate a per-request RSA-OAEP (SHA-256) keypair. The SPKI public key
    // (standard base64) is sent as the X-Hash header on the page-contents
    // query; the server returns `contents.hash`, an RSA-OAEP-encrypted AES key
    // we later decrypt with the matching PKCS8 private key (base64url). This
    // mirrors generateXHashAndKey() / pageListRequest() in the upstream source.
    const { publicKeyB64, privateKeyB64Url } = await generateRsaKeyPair();

    let data: ViewerData;
    if (type === "chapter") {
      data = await this.graphQL<ViewerData>(
        CHAPTER_QUERY,
        "FetchChapterContents",
        { comicId, chapterNumber: number },
        { "X-Hash": publicKeyB64 },
      );
    } else {
      data = await this.graphQL<ViewerData>(
        VOLUME_QUERY,
        "FetchMangaContents",
        { comicId, volumeNumber: number },
        { "X-Hash": publicKeyB64 },
      );
    }

    const contents = data.chapter?.contents ?? data.manga?.contents ?? null;
    if (!contents || contents.pages.length === 0) {
      throw new Error(
        "No page contents returned. This title likely requires a purchase/login. Locked content cannot be unlocked without an account that owns it.",
      );
    }

    // Bake the private key + RSA-encrypted AES key hash into each page URL's
    // fragment so interceptResponse can decrypt the served bytes. Matches the
    // upstream "${page.url}#${privateKey}:${hash}" page model.
    const hash = contents.hash;
    const pages = contents.pages.map(
      (p) => `${p.url}#${privateKeyB64Url}:${hash}`,
    );

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

  // mangaId is stored as "comicId#slug" mirroring the upstream manga.url.
  private buildMangaId(comic: ComicNode): string {
    return `${comic.comicId}#${comic.slug}`;
  }

  private parseMangaId(mangaId: string): { comicId: string; slug: string } {
    const decoded = this.safeDecode(mangaId);
    const hashIndex = decoded.indexOf("#");
    if (hashIndex === -1) {
      return { comicId: decoded, slug: "" };
    }
    return {
      comicId: decoded.slice(0, hashIndex),
      slug: decoded.slice(hashIndex + 1),
    };
  }

  private mangaUrl(mangaId: string): string {
    const { slug } = this.parseMangaId(mangaId);
    return `${BASE_URL}/manga/${slug}`;
  }

  private safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  private parseDate(value: string | null | undefined): Date {
    if (!value) return new Date(0);
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? new Date(0) : new Date(parsed);
  }

  private async graphQL<T>(
    query: string,
    operationName: string,
    variables: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const body = JSON.stringify({ query, operationName, variables });
    const request: Request = {
      url: API_URL,
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body,
    };
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error("Content not found");
    }
    const text = Application.arrayBufferToUTF8String(data);
    const envelope = JSON.parse(text) as GraphQLEnvelope<T>;
    if (envelope.errors && envelope.errors.length > 0) {
      const message = envelope.errors
        .map((e) => e.message ?? "")
        .filter((m) => m.length > 0)
        .join("\n");
      throw new Error(message || "GraphQL error");
    }
    if (!envelope.data) {
      throw new Error("GraphQL response is missing the 'data' field");
    }
    return envelope.data;
  }

  // ----------------------------------------------------------------
  // Cloudflare
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
}

// --------------------------------------------------------------------
// Per-request RSA-OAEP keypair + AES image decryption (module-level)
// --------------------------------------------------------------------

const WEBVIEW_SOURCE = {
  html: "<html><head></head><body></body></html>",
  baseUrl: BASE_URL,
  loadCSS: false,
  loadImages: false,
};

// Generate an RSA-OAEP (SHA-256) 2048-bit keypair inside a webview and export
// both halves. Public key: SPKI, standard base64 (X-Hash header). Private key:
// PKCS8, base64url (carried in the page fragment, matching Android's
// Base64.URL_SAFE|NO_WRAP encoding of the PKCS8 private key).
async function generateRsaKeyPair(): Promise<{
  publicKeyB64: string;
  privateKeyB64Url: string;
}> {
  const inject = `
(function () {
  return new Promise(function (resolve) {
    function abToB64(buf) {
      var bytes = new Uint8Array(buf);
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }
    crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"]
    ).then(function (pair) {
      return Promise.all([
        crypto.subtle.exportKey("spki", pair.publicKey),
        crypto.subtle.exportKey("pkcs8", pair.privateKey),
      ]);
    }).then(function (keys) {
      var pub = abToB64(keys[0]);
      var priv = abToB64(keys[1]).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
      resolve(JSON.stringify({ pub: pub, priv: priv }));
    }).catch(function () { resolve(""); });
  });
})()
`;

  const result = await Application.executeInWebView({
    source: WEBVIEW_SOURCE,
    inject,
    storage: { cookies: [] },
  });

  const parsed = JSON.parse(String(result.result || "{}")) as unknown;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "pub" in parsed &&
    "priv" in parsed &&
    typeof (parsed as { pub: unknown }).pub === "string" &&
    typeof (parsed as { priv: unknown }).priv === "string"
  ) {
    const obj = parsed as { pub: string; priv: string };
    if (obj.pub && obj.priv) {
      return { publicKeyB64: obj.pub, privateKeyB64Url: obj.priv };
    }
  }
  throw new Error("Failed to generate RSA keypair");
}

// Decrypt one page image. fragment = "<privateKeyB64Url>:<hashB64>".
// All crypto runs inside the webview's window.crypto.subtle:
//   1. import PKCS8 private key (RSA-OAEP, SHA-256)
//   2. RSA-OAEP-decrypt the hash -> raw AES key
//   3. read magic byte of the image:
//        == 2 -> skip 1, read 16-byte IV, AES-GCM (128-bit tag) decrypt rest
//        else -> IV = magicByte + next 15 bytes, AES-CBC (PKCS7) decrypt rest
async function decryptImage(
  fragment: string,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  const sep = fragment.indexOf(":");
  if (sep < 0) return data;
  const privateKeyB64Url = fragment.slice(0, sep);
  const hashB64 = fragment.slice(sep + 1);
  if (!privateKeyB64Url || !hashB64) return data;

  const imageB64 = bufferToBase64(data);

  const inject = `
(function () {
  return new Promise(function (resolve) {
    var PRIV = ${JSON.stringify(privateKeyB64Url)};
    var HASH = ${JSON.stringify(hashB64)};
    var IMG = ${JSON.stringify(imageB64)};

    function b64ToBytes(b64) {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function b64UrlToBytes(b64) {
      var s = b64.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      return b64ToBytes(s);
    }
    function bytesToB64(bytes) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }

    try {
      var privBytes = b64UrlToBytes(PRIV);
      var hashBytes = b64ToBytes(HASH);
      var img = b64ToBytes(IMG);

      crypto.subtle.importKey(
        "pkcs8", privBytes.buffer,
        { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]
      ).then(function (rsaKey) {
        return crypto.subtle.decrypt({ name: "RSA-OAEP" }, rsaKey, hashBytes.buffer);
      }).then(function (aesKeyBuf) {
        var aesKey = new Uint8Array(aesKeyBuf);
        var magic = img[0];
        if (magic === 2) {
          var ivG = img.slice(2, 18);
          var ctG = img.slice(18);
          return crypto.subtle.importKey("raw", aesKey.buffer, { name: "AES-GCM" }, false, ["decrypt"])
            .then(function (k) {
              return crypto.subtle.decrypt({ name: "AES-GCM", iv: ivG.buffer, tagLength: 128 }, k, ctG.buffer);
            });
        } else {
          var iv = new Uint8Array(16);
          iv[0] = magic;
          var rest = img.slice(1, 16);
          iv.set(rest, 1);
          var ctC = img.slice(16);
          return crypto.subtle.importKey("raw", aesKey.buffer, { name: "AES-CBC" }, false, ["decrypt"])
            .then(function (k) {
              return crypto.subtle.decrypt({ name: "AES-CBC", iv: iv.buffer }, k, ctC.buffer);
            });
        }
      }).then(function (plainBuf) {
        resolve(bytesToB64(new Uint8Array(plainBuf)));
      }).catch(function () { resolve(""); });
    } catch (e) { resolve(""); }
  });
})()
`;

  const result = await Application.executeInWebView({
    source: WEBVIEW_SOURCE,
    inject,
    storage: { cookies: [] },
  });

  const out = String(result.result || "");
  if (!out) return data;
  return base64ToBuffer(out);
}

function bufferToBase64(data: ArrayBuffer): string {
  const encoded = Application.base64Encode(data);
  return typeof encoded === "string"
    ? encoded
    : Application.arrayBufferToUTF8String(encoded);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const decoded = Application.base64Decode(b64);
  if (typeof decoded === "string") {
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out.buffer;
  }
  return decoded;
}

export const emaqi = new EmaqiExtension();
