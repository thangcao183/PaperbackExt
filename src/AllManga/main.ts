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
import * as htmlparser2 from "htmlparser2";
import { AllMangaSearchForm, AllMangaSearchMeta } from "./forms";
import { AllMangaSettingsForm, getImageQuality, getShowAdult } from "./settings";

const BASE_URL = "https://allmanga.to";
const API_URL = "https://api.allanime.day/api";
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
const IMAGE_CDN = "https://wp.youtube-anime.com";
const LIMIT = 20;
const URL_REGEX = /^https?:\/\/.*/;

const POPULAR_QUERY =
  "query ($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) { queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) { recommendations { anyCard { _id name thumbnail englishName } } } }";

const SEARCH_QUERY =
  "query ($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) { mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) { edges { _id name thumbnail englishName } } }";

const DETAILS_QUERY =
  "query ($id: String!) { manga(_id: $id) { _id name thumbnail description authors genres tags status altNames englishName } }";

const CHAPTERS_QUERY =
  "query ($id: String!, $showId: String!) { manga(_id: $id) { _id name availableChaptersDetail } episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) { episodeIdNum notes uploadDates } }";

interface AnyCard {
  _id: string;
  name: string;
  thumbnail?: string;
  englishName?: string;
}

interface PopularResponse {
  queryPopular: { recommendations: { anyCard: AnyCard | null }[] };
}

interface SearchResponse {
  mangas: { edges: AnyCard[] };
}

interface MangaDetails {
  _id: string;
  name: string;
  thumbnail?: string;
  description?: string;
  authors?: string[];
  genres?: string[];
  tags?: string[];
  status?: string;
  altNames?: string[];
  englishName?: string;
}

interface DetailsResponse {
  manga: MangaDetails;
}

interface EpisodeInfo {
  episodeIdNum: number | string;
  notes?: string;
  uploadDates?: { sub?: string };
}

interface ChaptersResponse {
  manga: { _id: string; name: string; availableChaptersDetail?: { sub?: string[] } };
  episodeInfos?: EpisodeInfo[];
}

interface PictureUrl {
  url?: string;
}

interface ServerEdge {
  pictureUrlHead?: string;
  pictureUrls?: PictureUrl[];
}

interface PageListData {
  chapterPages?: { edges?: ServerEdge[] };
}

class AllMangaInterceptor extends PaperbackInterceptor {
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
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

type AllMangaImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

class AllMangaExtension implements AllMangaImplementation {
  requestManager = new AllMangaInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
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

  async getSettingsForm(): Promise<Form> {
    return new AllMangaSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const itemType =
      section.id === "popular" ? "featuredCarouselItem" : "simpleCarouselItem";

    let cards: AnyCard[];
    let hasNextPage: boolean;

    if (section.id === "popular") {
      const data = await this.fetchGraphQL<PopularResponse>(POPULAR_QUERY, {
        type: "manga",
        size: LIMIT,
        dateRange: 0,
        page,
        allowAdult: getShowAdult(),
        allowUnknown: false,
      });
      const recs = data.queryPopular?.recommendations ?? [];
      cards = recs.map((r) => r.anyCard).filter((c): c is AnyCard => c != null);
      hasNextPage = recs.length === LIMIT;
    } else {
      const data = await this.fetchGraphQL<SearchResponse>(SEARCH_QUERY, {
        search: { isManga: true, allowAdult: getShowAdult(), allowUnknown: false },
        size: LIMIT,
        page,
        translationType: "sub",
        countryOrigin: "ALL",
      });
      cards = data.mangas?.edges ?? [];
      hasNextPage = cards.length === LIMIT;
    }

    const items: DiscoverSectionItem[] = cards.map((card) => ({
      type: itemType,
      mangaId: this.mangaIdFromCard(card),
      imageUrl: this.parseThumbnailUrl(card.thumbnail),
      title: card.englishName || card.name,
      metadata: undefined,
    }));

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const titleQuery = query.title.trim();
    const searchMeta = (query.metadata as { searchMeta?: AllMangaSearchMeta } | undefined)
      ?.searchMeta;

    const sort = searchMeta?.sort?.[0];
    const country = searchMeta?.country?.[0];
    const includeGenres = searchMeta?.includeGenres ?? [];
    const excludeGenres = searchMeta?.excludeGenres ?? [];

    const search: Record<string, unknown> = {
      isManga: true,
      allowAdult: getShowAdult(),
      allowUnknown: false,
    };
    if (titleQuery.length > 0) search.query = titleQuery;
    if (sort && sort.length > 0) search.sortBy = sort;
    if (includeGenres.length > 0) search.genres = includeGenres;
    if (excludeGenres.length > 0) search.excludeGenres = excludeGenres;

    const data = await this.fetchGraphQL<SearchResponse>(SEARCH_QUERY, {
      search,
      size: LIMIT,
      page,
      translationType: "sub",
      countryOrigin: country && country.length > 0 ? country : "ALL",
    });

    const cards = data.mangas?.edges ?? [];
    const items: SearchResultItem[] = cards.map((card) => ({
      mangaId: this.mangaIdFromCard(card),
      imageUrl: this.parseThumbnailUrl(card.thumbnail),
      title: card.englishName || card.name,
      subtitle: undefined,
      metadata: undefined,
    }));

    return { items, metadata: cards.length === LIMIT ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(): Promise<AdvancedSearchForm> {
    return new AllMangaSearchForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = this.idFromMangaId(mangaId);
    const data = await this.fetchGraphQL<DetailsResponse>(DETAILS_QUERY, { id });
    const manga = data.manga;

    let synopsis = this.stripHtml(manga.description ?? "");
    const altNames = manga.altNames ?? [];
    if (altNames.length > 0) {
      const header = synopsis.length === 0 ? "Alternative Titles:\n" : "\n\nAlternative Titles:\n";
      synopsis += header + altNames.map((n) => `\u2022 ${n.trim()}`).join("\n");
    }

    const author =
      manga.authors && manga.authors.length > 0 ? manga.authors[0].trim() : undefined;

    const genreNames = [...(manga.genres ?? []), ...(manga.tags ?? [])];
    const tagGroups: TagSection[] =
      genreNames.length > 0
        ? [
            {
              id: "genres",
              title: "Genres",
              tags: genreNames.map((g) => ({
                id: g.toLowerCase().replace(/\s+/g, "-"),
                title: g,
              })),
            },
          ]
        : [];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: manga.englishName || manga.name,
        secondaryTitles: [],
        thumbnailUrl: this.parseThumbnailUrl(manga.thumbnail),
        author,
        artist: author,
        synopsis,
        contentRating: ContentRating.MATURE,
        status: this.parseStatus(manga.status),
        tagGroups,
        shareUrl: `${BASE_URL}/manga/${id}`,
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = this.idFromMangaId(sourceManga.mangaId);
    const data = await this.fetchGraphQL<ChaptersResponse>(CHAPTERS_QUERY, {
      id,
      showId: `manga@${id}`,
    });

    const slug = this.titleToSlug(data.manga.name);
    const chapterNums = data.manga.availableChaptersDetail?.sub ?? [];
    const episodeMap = new Map<string, EpisodeInfo>();
    for (const info of data.episodeInfos ?? []) {
      episodeMap.set(String(info.episodeIdNum), info);
    }

    const chapters: Chapter[] = [];
    for (const chapterNum of chapterNums) {
      const info = episodeMap.get(String(chapterNum));
      const title = info?.notes?.trim() ?? "";
      let name = `Chapter ${chapterNum}`;
      if (title.length > 0 && !/\d/.test(title)) name += `: ${title}`;
      const chapterUrl = `/read/${id}/${slug}/chapter-${chapterNum}-sub`;

      chapters.push({
        chapterId: this.toSafeId(chapterUrl),
        sourceManga,
        title: name,
        volume: 0,
        chapNum: parseFloat(chapterNum) || 0,
        publishDate: this.parseDate(info?.uploadDates?.sub),
        langCode: "\ud83c\uddec\ud83c\udde7",
      });
    }

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = this.chapterShareUrl(chapter.chapterId);
    const [response, data] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    if (response.status === 404) throw new Error("Content not found");
    const html = Application.arrayBufferToUTF8String(data);

    const inject = `
      (function(){
        window.__cap = null;
        var orig = JSON.parse;
        JSON.parse = function(text){
          var obj = orig.apply(this, arguments);
          try {
            if (obj && obj.data && obj.data.chapterPages) { window.__cap = obj.data; }
            else if (obj && obj.chapterPages) { window.__cap = obj; }
          } catch(e){}
          return obj;
        };
      })();
      new Promise(function(resolve){
        var start = Date.now();
        var t = setInterval(function(){
          if (window.__cap) { clearInterval(t); resolve(JSON.stringify(window.__cap)); }
          else if (Date.now() - start > 28000) { clearInterval(t); resolve("null"); }
        }, 250);
      });
    `;

    const result = await Application.executeInWebView({
      source: { html, baseUrl: chapterUrl, loadCSS: false, loadImages: false },
      inject,
      storage: { cookies: [] },
    });

    const payload = JSON.parse(String(result.result ?? "null")) as PageListData | null;
    const edges = payload?.chapterPages?.edges ?? [];
    if (edges.length === 0) {
      return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: [] };
    }

    let chosen = edges.find((edge) => {
      const urls = edge.pictureUrls ?? [];
      const sample = urls.length > 0 ? urls[0].url : undefined;
      return (sample && URL_REGEX.test(sample)) || edge.pictureUrlHead != null;
    });
    if (!chosen) chosen = edges[0];

    const serverUrl = chosen.pictureUrlHead;
    let imageDomain = "https://ytimgf.youtube-anime.com/";
    if (serverUrl) {
      imageDomain = URL_REGEX.test(serverUrl)
        ? serverUrl.replace(/\/$/, "") + "/"
        : "https://" + serverUrl.replace(/\/$/, "") + "/";
    }

    const quality = getImageQuality();
    const pages: string[] = [];
    for (const img of chosen.pictureUrls ?? []) {
      if (!img.url) continue;
      let url = URL_REGEX.test(img.url) ? img.url : imageDomain + img.url.replace(/^\//, "");
      if (quality !== "original") {
        const match = url.match(/^https?:\/\/([^#]+)/);
        if (match) url = `${IMAGE_CDN}/${match[1]}?w=${quality}`;
      }
      pages.push(url);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getMangaShareUrl(mangaId: string): Promise<string> {
    return `${BASE_URL}/manga/${this.idFromMangaId(mangaId)}`;
  }

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

  private async fetchGraphQL<T>(query: string, variables: unknown): Promise<T> {
    const [response, data] = await Application.scheduleRequest({
      url: API_URL,
      method: "POST",
      headers: { "content-type": "application/json", referer: `${BASE_URL}/` },
      body: JSON.stringify({ variables, query }),
    });
    if (response.status === 404) throw new Error("Content not found");
    const json = JSON.parse(Application.arrayBufferToUTF8String(data)) as { data: T };
    return json.data;
  }

  private mangaIdFromCard(card: AnyCard): string {
    return this.toSafeId(`/manga/${card._id}/${this.titleToSlug(card.name)}`);
  }

  private idFromMangaId(mangaId: string): string {
    const decoded = this.safeDecode(mangaId);
    const parts = decoded.split("/");
    return parts[2] ?? decoded;
  }

  private chapterShareUrl(chapterId: string): string {
    const decoded = this.safeDecode(chapterId);
    const parts = decoded.split("/");
    const mangaId = parts[2] ?? "";
    const chapterSlug = parts[4] ?? "";
    return `${BASE_URL}/manga/${mangaId}/${chapterSlug}`;
  }

  private titleToSlug(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  private parseThumbnailUrl(thumbnail?: string): string {
    if (!thumbnail) return "";
    if (URL_REGEX.test(thumbnail)) return thumbnail;
    return `${THUMBNAIL_CDN}${thumbnail}?w=250`;
  }

  private parseStatus(status?: string): string {
    const s = (status ?? "").toLowerCase();
    if (s.includes("releasing")) return "Ongoing";
    if (s.includes("finished")) return "Completed";
    return "Unknown";
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date(0);
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  private stripHtml(html: string): string {
    if (!html) return "";
    const dom = htmlparser2.parseDocument(html);
    const $ = cheerio.load(dom);
    return $.root().text().trim();
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
}

export const AllManga = new AllMangaExtension();
