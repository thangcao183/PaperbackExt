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
  SortingOption,
  SourceManga,
  TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { render as renderDom } from "dom-serializer";
import * as htmlparser2 from "htmlparser2";
import { URLBuilder } from "../url-builder/base";
import { decryptChapterProtector } from "./chapter-protector";
import { MadaraSearchForm, MadaraSearchMeta } from "./forms";
import { getBaseUrlOverride, MadaraSettingsForm } from "./settings";

export interface MadaraConfig {
  name: string;
  baseUrl: string;
  mangaSubString?: string;
  useNewChapterEndpoint?: boolean;
  contentRating?: ContentRating;
  langCode?: string;

  // --- Optional per-source overrides (mirror the upstream keiyoushi Madara
  // subclass overrides). All default to the framework's standard behavior, so
  // omitting them keeps a source identical to a plain Madara site. ---

  /** Upstream `useLoadMoreRequest = LoadMoreStrategy.Always`: browse popular /
   * latest through the `madara_load_more` admin-ajax endpoint instead of
   * page-navigation. */
  useLoadMoreRequest?: boolean;
  /** Upstream `filterNonMangaItems` (default true): restrict listings to
   * `_wp_manga_chapter_type = manga` in the load-more query. */
  filterNonMangaItems?: boolean;
  /** Upstream `supportsLatest = false`: hide the "Latest Updates" section. */
  supportsLatest?: boolean;
  /** Anchor selector for popular list items (upstream `popularMangaUrlSelector`). */
  popularMangaUrlSelector?: string;
  /** Anchor selector for search list items (upstream `searchMangaUrlSelector`). */
  searchMangaUrlSelector?: string;
  /** Chapter `<li>` selector (upstream `chapterListSelector`). */
  chapterListSelector?: string;
  /** Suffix appended to a chapter URL. Default `?style=list`; set `""` to drop. */
  chapterUrlSuffix?: string;
  /** Page-image container selector (upstream `pageListParseSelector`). */
  pageListSelector?: string;
  /** Manga-details selector overrides (upstream `mangaDetailsSelector*`). */
  mangaDetailsTitleSelector?: string;
  mangaDetailsStatusSelector?: string;
  mangaDetailsDescriptionSelector?: string;
  mangaDetailsThumbnailSelector?: string;
  mangaDetailsAuthorSelector?: string;
  mangaDetailsArtistSelector?: string;
}

interface MadaraMetadata {
  page?: number;
  collectedIds?: string[];
  searchCollectedIds?: string[];
}

class MadaraInterceptor extends PaperbackInterceptor {
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
      "accept-encoding": "gzip, deflate, br",
      "cache-control": "no-cache",
      pragma: "no-cache",
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
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

type MadaraImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding &
  SettingsFormProviding &
  DiscoverSectionProviding;

export class MadaraExtension implements MadaraImplementation {
  // Maximum number of pages to fetch when paginating search results.
  static readonly MAX_SEARCH_PAGES = 5;

  readonly sourceName: string;
  readonly defaultBaseUrl: string;
  readonly mangaSubString: string;
  readonly useNewChapterEndpoint: boolean;
  readonly contentRating: ContentRating;
  readonly langCode: string;

  readonly useLoadMoreRequest: boolean;
  readonly filterNonMangaItems: boolean;
  readonly supportsLatest: boolean;
  readonly popularMangaUrlSelector: string;
  readonly searchMangaUrlSelector: string;
  readonly chapterListSelector: string;
  readonly chapterUrlSuffix: string;
  readonly pageListSelector: string;
  readonly mangaDetailsTitleSelector: string;
  readonly mangaDetailsStatusSelector?: string;
  readonly mangaDetailsDescriptionSelector?: string;
  readonly mangaDetailsThumbnailSelector?: string;
  readonly mangaDetailsAuthorSelector?: string;
  readonly mangaDetailsArtistSelector?: string;

  /**
   * Effective base URL: a user-configured override (set via the settings
   * form) takes precedence over the bundled default. This lets users follow
   * a site that has changed domain without waiting for an extension update.
   */
  get baseUrl(): string {
    return getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
  }

  requestManager: MadaraInterceptor;
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });

  constructor(config: MadaraConfig) {
    this.sourceName = config.name;
    this.defaultBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.mangaSubString = config.mangaSubString ?? "manga";
    this.useNewChapterEndpoint = config.useNewChapterEndpoint ?? false;
    this.contentRating = config.contentRating ?? ContentRating.EVERYONE;
    this.langCode = config.langCode ?? "🇬🇧";

    this.useLoadMoreRequest = config.useLoadMoreRequest ?? false;
    this.filterNonMangaItems = config.filterNonMangaItems ?? true;
    this.supportsLatest = config.supportsLatest ?? true;
    this.popularMangaUrlSelector =
      config.popularMangaUrlSelector ?? "div.post-title a";
    this.searchMangaUrlSelector =
      config.searchMangaUrlSelector ?? "div.post-title a";
    this.chapterListSelector = config.chapterListSelector ?? "li.wp-manga-chapter";
    this.chapterUrlSuffix = config.chapterUrlSuffix ?? "?style=list";
    this.pageListSelector =
      config.pageListSelector ??
      "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item)) img";
    this.mangaDetailsTitleSelector =
      config.mangaDetailsTitleSelector ??
      "div.post-title h3, div.post-title h1, #manga-title > h1";
    this.mangaDetailsStatusSelector = config.mangaDetailsStatusSelector;
    this.mangaDetailsDescriptionSelector =
      config.mangaDetailsDescriptionSelector;
    this.mangaDetailsThumbnailSelector = config.mangaDetailsThumbnailSelector;
    this.mangaDetailsAuthorSelector = config.mangaDetailsAuthorSelector;
    this.mangaDetailsArtistSelector = config.mangaDetailsArtistSelector;

    this.requestManager = new MadaraInterceptor("main", () => this.baseUrl);
  }

  async getSettingsForm(): Promise<Form> {
    return new MadaraSettingsForm(this.sourceName, this.defaultBaseUrl);
  }

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const sections: DiscoverSection[] = [
      {
        id: "popular_section",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
    ];
    if (this.supportsLatest) {
      sections.push({
        id: "latest_section",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      });
    }
    return sections;
  }

  async getAdvancedSearchForm(
    query: SearchQuery<Metadata>,
  ): Promise<AdvancedSearchForm> {
    const meta = query.metadata as
      | { searchMeta?: MadaraSearchMeta }
      | undefined;
    return new MadaraSearchForm(meta?.searchMeta);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as MadaraMetadata | undefined;
    switch (section.id) {
      case "popular_section":
        return this.getMangaListItems(meta, "views", "featuredCarouselItem");
      case "latest_section":
        return this.getMangaListItems(meta, "latest", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getMangaListItems(
    metadata: MadaraMetadata | undefined,
    orderBy: "views" | "latest",
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    let $: CheerioAPI;
    if (this.useLoadMoreRequest) {
      // Sites with LoadMoreStrategy.Always serve listings only through the
      // madara_load_more admin-ajax endpoint (page is 0-indexed).
      $ = await this.fetchCheerio({
        url: `${this.baseUrl}/wp-admin/admin-ajax.php`,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          referer: `${this.baseUrl}/`,
        },
        body: this.loadMoreBody(page, orderBy === "views"),
      });
    } else {
      const builder = new URLBuilder(this.baseUrl).addPath(this.mangaSubString);
      if (page > 1) {
        builder.addPath("page").addPath(page.toString());
      }
      const url = builder.addQuery("m_orderby", orderBy).build();
      $ = await this.fetchCheerio({ url, method: "GET" });
    }

    const items: DiscoverSectionItem[] = [];

    $("div.page-item-detail, .manga__item").each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find(this.popularMangaUrlSelector).first();
      const title = titleLink.text().trim() || titleLink.attr("title") || "";
      const href = titleLink.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

      if (title && mangaId && !collectedIds.includes(mangaId)) {
        collectedIds.push(mangaId);
        items.push({
          type: itemType,
          mangaId,
          imageUrl: image,
          title,
          metadata: undefined,
        });
      }
    });

    // With load-more, an empty fragment means no more pages.
    const hasNextPage = this.useLoadMoreRequest
      ? items.length > 0
      : $("div.nav-previous, nav.navigation-ajax, a.nextpostslink").length > 0;

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  /** Build the `madara_load_more` admin-ajax form body (mirrors upstream). */
  protected loadMoreBody(page: number, popular: boolean): string {
    const params: [string, string][] = [
      ["action", "madara_load_more"],
      ["page", (page - 1).toString()],
      ["template", "madara-core/content/content-archive"],
      ["vars[orderby]", "meta_value_num"],
      ["vars[paged]", "1"],
    ];
    if (this.filterNonMangaItems) {
      params.push(["vars[meta_query][0][key]", "_wp_manga_chapter_type"]);
      params.push(["vars[meta_query][0][value]", "manga"]);
    }
    params.push(
      ["vars[post_type]", "wp-manga"],
      ["vars[post_status]", "publish"],
      ["vars[meta_key]", popular ? "_wp_manga_views" : "_latest_update"],
      ["vars[order]", "desc"],
      ["vars[sidebar]", "right"],
      ["vars[manga_archives_item_layout]", "big_thumbnail"],
    );
    return params
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
      )
      .join("&");
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return [
      { id: "", label: "Relevance" },
      { id: "latest", label: "Latest" },
      { id: "alphabet", label: "A-Z" },
      { id: "rating", label: "Rating" },
      { id: "trending", label: "Trending" },
      { id: "views", label: "Most Views" },
      { id: "new-manga", label: "New" },
    ];
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as MadaraMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.searchCollectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    const searchMeta = (
      query.metadata as { searchMeta?: MadaraSearchMeta } | undefined
    )?.searchMeta;

    // Determine whether any advanced filter has been set.
    const hasFilters = !!(
      searchMeta &&
      (searchMeta.author ||
        searchMeta.artist ||
        searchMeta.release ||
        (searchMeta.status && searchMeta.status.length > 0) ||
        (searchMeta.orderBy &&
          searchMeta.orderBy.length > 0 &&
          searchMeta.orderBy[0] !== "") ||
        (searchMeta.adult &&
          searchMeta.adult.length > 0 &&
          searchMeta.adult[0] !== "") ||
        (searchMeta.genreCondition &&
          searchMeta.genreCondition.length > 0 &&
          searchMeta.genreCondition[0] !== ""))
    );

    // With no query term and no filters, browse the full manga listing
    // (same endpoint as the "Latest Updates" discover section) instead of
    // returning nothing. This mirrors how a bare search behaves elsewhere.
    const browseAll = !titleQuery && !hasFilters;

    // The sorting dropdown (getSortingOptions) takes precedence over the
    // advanced-form orderBy when the user picks a non-empty value.
    const sortId = sortingOption?.id ?? "";
    const filterOrderBy =
      searchMeta?.orderBy && searchMeta.orderBy.length > 0
        ? searchMeta.orderBy[0]
        : "";
    const effectiveOrderBy = sortId || filterOrderBy;

    const builder = new URLBuilder(this.baseUrl);
    if (browseAll) {
      builder.addPath(this.mangaSubString);
      if (page > 1) {
        builder.addPath("page").addPath(page.toString());
      }
      builder.addQuery("m_orderby", effectiveOrderBy || "latest");
    } else {
      if (page > 1) {
        builder.addPath("page").addPath(page.toString());
      }
      builder
        .addQuery("s", encodeURIComponent(titleQuery))
        .addQuery("post_type", "wp-manga");

      if (searchMeta) {
        if (searchMeta.author) {
          builder.addQuery("author", encodeURIComponent(searchMeta.author));
        }
        if (searchMeta.artist) {
          builder.addQuery("artist", encodeURIComponent(searchMeta.artist));
        }
        if (searchMeta.release) {
          builder.addQuery("release", encodeURIComponent(searchMeta.release));
        }
        if (searchMeta.status && searchMeta.status.length > 0) {
          builder.addQuery("status", searchMeta.status);
        }
        if (
          searchMeta.adult &&
          searchMeta.adult.length > 0 &&
          searchMeta.adult[0] !== ""
        ) {
          builder.addQuery("adult", searchMeta.adult[0]);
        }
        if (
          searchMeta.genreCondition &&
          searchMeta.genreCondition.length > 0 &&
          searchMeta.genreCondition[0] !== ""
        ) {
          builder.addQuery("op", searchMeta.genreCondition[0]);
        }
      }

      if (effectiveOrderBy) {
        builder.addQuery("m_orderby", effectiveOrderBy);
      }
    }

    const url = builder.build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];

    // The listing page and the search page use different item containers.
    // Some themes use `c-tabs-item__content` for search; others reuse
    // `page-item-detail` (the same container as browse pages). Include both.
    const itemSelector = browseAll
      ? "div.page-item-detail, .manga__item"
      : "div.c-tabs-item__content, div.page-item-detail, .manga__item";

    $(itemSelector).each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find(this.searchMangaUrlSelector).first();
      const title = titleLink.text().trim() || titleLink.attr("title") || "";
      const href = titleLink.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

      if (title && mangaId && !collectedIds.includes(mangaId)) {
        collectedIds.push(mangaId);
        results.push({
          mangaId,
          imageUrl: image,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    const hasNextPage =
      $("div.nav-previous, nav.navigation-ajax, a.nextpostslink").length > 0;

    // Cap search pagination so the app doesn't keep loading every page.
    const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit
          ? { page: page + 1, searchCollectedIds: collectedIds }
          : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Manga details
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $(this.mangaDetailsTitleSelector).first().text().trim();

    const altTitles: string[] = [];
    $("div.post-content_item:contains(Alternative) div.summary-content")
      .first()
      .text()
      .split(/[,;]/)
      .forEach((t) => {
        const trimmed = t.trim();
        if (trimmed) altTitles.push(trimmed);
      });

    const image = this.imageFromElement(
      $(this.mangaDetailsThumbnailSelector ?? "div.summary_image img").first(),
    );

    const description = $(
      this.mangaDetailsDescriptionSelector ??
        "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt",
    )
      .first()
      .text()
      .trim();

    const authors: string[] = [];
    $(
      this.mangaDetailsAuthorSelector ??
        "div.author-content > a, div.manga-authors > a",
    ).each((_, el) => {
      const a = $(el).text().trim();
      if (a) authors.push(a);
    });

    const artists: string[] = [];
    $(this.mangaDetailsArtistSelector ?? "div.artist-content > a").each(
      (_, el) => {
        const a = $(el).text().trim();
        if (a) artists.push(a);
      },
    );

    let status = "Unknown";
    if (this.mangaDetailsStatusSelector) {
      status =
        $(this.mangaDetailsStatusSelector).first().text().trim() || status;
    } else {
      $("div.post-content_item, div.post-status div.summary-content").each(
        (_, el) => {
          const block = $(el);
          if (block.find("div.summary-heading").text().includes("Status")) {
            status = block.find("div.summary-content").text().trim() || status;
          }
        },
      );
    }

    const genres: string[] = [];
    $("div.genres-content a").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });

    const tagItems: string[] = [];
    $("div.tags-content a").each((_, el) => {
      const t = $(el).text().trim();
      if (t) tagItems.push(t);
    });

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
    if (tagItems.length > 0) {
      tagGroups.push({
        id: "tags",
        title: "Tags",
        tags: tagItems.map((t) => ({
          id: t.toLowerCase().replace(/\s+/g, "-"),
          title: t,
        })),
      });
    }

    let rating = 0;
    const ratingValue = $("span#averagerate, span.score.total_votes")
      .first()
      .text()
      .trim();
    if (ratingValue) {
      const parsed = parseFloat(ratingValue);
      if (!isNaN(parsed)) rating = parsed / 5;
    }

    // Some Madara sites host both comics and text novels. The reader the app
    // opens is chosen by `contentType`; misclassifying a novel as a comic
    // makes the comic reader reject the HTML chapter details. Detect novels
    // via the title badge (e.g. `manga-title-badges ... novel-15` -> "Novel")
    // or a "Type: Novel" metadata row, falling back to comic.
    const badgeText = $(".manga-title-badges").text().toLowerCase();
    let typeMeta = "";
    $("div.post-content_item").each((_, el) => {
      const block = $(el);
      if (block.find("div.summary-heading").text().toLowerCase().includes("type")) {
        typeMeta = block.find("div.summary-content").text().toLowerCase();
      }
    });
    const isNovel =
      /\bnovel\b/.test(badgeText) ||
      $(".manga-title-badges.novel, .manga-title-badges[class*='novel']").length >
        0 ||
      /\bnovel\b/.test(typeMeta);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altTitles,
        thumbnailUrl: image,
        author: authors.join(", ") || undefined,
        artist: artists.join(", ") || undefined,
        synopsis: description,
        rating,
        contentRating: this.contentRating,
        contentType: isNovel ? "novel" : "comic",
        status: this.parseStatus(status),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters
  // ----------------------------------------------------------------

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const mangaUrl = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();

    let $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    let chapterElements = $(this.chapterListSelector);

    // Madara frequently loads chapters via AJAX. Fall back to the
    // modern endpoint: POST {mangaUrl}/ajax/chapters
    if (chapterElements.length === 0) {
      try {
        const ajax = await this.fetchCheerio({
          url: `${mangaUrl}/ajax/chapters`,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            referer: `${mangaUrl}/`,
            "x-requested-with": "XMLHttpRequest",
          },
        });
        if (ajax(this.chapterListSelector).length > 0) {
          $ = ajax;
          chapterElements = ajax(this.chapterListSelector);
        }
      } catch {
        // ignore, fall through with whatever we have
      }
    }

    const chapters: Chapter[] = [];
    chapterElements.each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterTitle = link.text().trim();
      const chapterId = this.parseChapterId(href, mangaId);
      if (!chapterId) return;

      let chapNum = 0;
      // Sites label chapters as "Chapter", "Episode", "Ch.", etc. Match the
      // known keywords first, then fall back to the slug, then to any trailing
      // number in the title.
      const numMatch = chapterTitle.match(
        /(?:chapter|episode|ch)[.\s-]*(\d+(?:\.\d+)?)/i,
      );
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const slugMatch = chapterId.match(
          /(?:chapter|episode|ch)-(\d+(?:[.-]\d+)?)/i,
        );
        if (slugMatch) {
          chapNum = parseFloat(slugMatch[1].replace("-", "."));
        } else {
          const titleNum = chapterTitle.match(/(\d+(?:\.\d+)?)/);
          if (titleNum) chapNum = parseFloat(titleNum[1]);
        }
      }

      const dateText = el.find("span.chapter-release-date").text().trim();
      const publishDate = this.parseDate(dateText);

      chapters.push({
        chapterId,
        sourceManga,
        title: chapterTitle,
        volume: 0,
        chapNum,
        publishDate,
        langCode: this.langCode,
      });
    });

    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const builder = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(chapter.sourceManga.mangaId)
      .addPath(chapter.chapterId);
    // Default suffix `?style=list`; a source may override or disable it.
    if (this.chapterUrlSuffix === "?style=list") {
      builder.addQuery("style", "list");
    }
    let url = builder.build();
    if (this.chapterUrlSuffix && this.chapterUrlSuffix !== "?style=list") {
      url += this.chapterUrlSuffix;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const pages: string[] = [];

    // Real (image) manga may be served behind the Madara "chapter protector":
    // the page list is AES-encrypted in a `#chapter-protector-data` script
    // rather than inline `<img>` tags. Decrypt it when present; otherwise fall
    // back to scraping plain image elements.
    // The protector decrypt parses/decrypts site-controlled data; never let a
    // malformed payload throw out of here (that surfaces as a chapter error /
    // crash). On any failure, fall back to scraping plain `<img>` elements.
    let protectedPages: string[] | null = null;
    try {
      protectedPages = await decryptChapterProtector($);
    } catch {
      protectedPages = null;
    }
    if (protectedPages && protectedPages.length > 0) {
      for (const p of protectedPages) {
        const src = (p || "").trim();
        if (src) pages.push(src);
      }
    }
    if (pages.length === 0) {
      $(this.pageListSelector).each((_, element) => {
        const el = $(element);
        const img = el.is("img") ? el : el.find("img").first();
        const image = this.imageFromElement(img);
        if (image) pages.push(image);
      });
    }

    const uniquePages = [...new Set(pages)];

    // Some Madara sites host text novels (`chapter-type-text`) where the
    // chapter body is prose inside `.reading-content` with no page images.
    // Returning an empty image page list crashes the reader, so emit an HTML
    // (novel) chapter instead when no images were found but text content
    // exists.
    if (uniquePages.length === 0) {
      const html = this.extractNovelHtml($);
      if (html) {
        return {
          id: chapter.chapterId,
          mangaId: chapter.sourceManga.mangaId,
          type: "html",
          html,
        };
      }
      // No images and no prose. Returning an empty `pages` array crashes the
      // reader, so surface a clean error instead.
      throw new Error(
        "No pages found for this chapter; the page list may be loaded " +
          "dynamically or the site layout changed.",
      );
    }
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: uniquePages,
    };
  }

  // Extract readable prose for text-novel chapters. Returns a well-formed
  // XHTML document, or "" if no meaningful text is present.
  //
  // The Paperback novel reader parses the returned `html` as XHTML (XML), so
  // the string MUST be a single rooted, well-formed document: void tags
  // self-closed (`<br/>`, `<img/>`), named entities like `&nbsp;` converted to
  // numeric/character form, and `&`/`<`/`>` escaped. Returning the container's
  // raw innerHTML (dozens of sibling `<p>` nodes, unclosed `<br>`, `&nbsp;`)
  // triggers `Extra content at the end of the document` / parse errors. We
  // serialize through dom-serializer in `xmlMode` to guarantee well-formedness.
  protected extractNovelHtml($: CheerioAPI): string {
    const container = $(
      ".reading-content .text-left, .reading-content .text-right, .reading-content .entry-content",
    ).first();
    const target = container.length > 0 ? container : $(".reading-content");
    if (target.length === 0) return "";

    // Drop non-prose noise (scripts, ads, nav, related widgets).
    const clone = target.clone();
    clone
      .find(
        "script, style, ins, .code-block, .adsbygoogle, nav, .navigation, iframe, .chapter-warning, .c-ads",
      )
      .remove();

    // Require some actual text so we don't emit an empty/whitespace body.
    if (clone.text().trim().length === 0) return "";

    // Serialize each child node as XML (self-closes void elements, encodes
    // entities) so the concatenation is well-formed XHTML.
    let inner = "";
    const children = clone.children().toArray();
    if (children.length > 0) {
      for (const node of children) {
        inner += renderDom(node, { xmlMode: true, decodeEntities: true });
      }
    } else {
      // No element children (plain text only): escape and wrap in a paragraph.
      inner = `<p>${this.escapeXml(clone.text().trim())}</p>`;
    }

    if (!inner.trim()) return "";

    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${inner}</body></html>`
    );
  }

  /** Escape the five XML special characters for use in text content. */
  protected escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  getMangaShareUrl(mangaId: string): string {
    return new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  protected parseMangaId(href: string): string {
    const match = href.match(
      new RegExp(`/${this.mangaSubString}/([^/]+)`),
    );
    if (match) return this.toSafeId(match[1]);
    // fallback: generic /<seg>/<slug>
    const generic = href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/");
    return this.toSafeId(generic.pop() ?? "");
  }

  protected parseChapterId(href: string, mangaId: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    // mangaId may be percent-encoded; the raw href is not, so decode it
    // back when locating the manga segment within the chapter URL.
    const rawMangaId = this.safeDecode(mangaId);
    const marker = `/${this.mangaSubString}/${rawMangaId}/`;
    const idx = cleaned.indexOf(marker);
    if (idx !== -1) {
      return this.toSafeId(cleaned.slice(idx + marker.length));
    }
    return this.toSafeId(cleaned.split("/").pop() ?? "");
  }

  // Paperback only allows IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
  // Slugs can contain decoded HTML entities such as apostrophes (from
  // `&#39;`), so percent-encode any disallowed character. The encoded ID
  // round-trips correctly when interpolated back into a request URL.
  protected toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
      const enc = encodeURIComponent(c);
      if (enc !== c) return enc;
      return (
        "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
      );
    });
  }

  protected safeDecode(id: string): string {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  }

  protected imageFromElement(img: Cheerio<AnyNode>): string {
    if (!img || img.length === 0) return "";
    let src = img.attr("data-src") || img.attr("data-lazy-src") || "";

    if (!src) {
      const srcset = img.attr("srcset");
      if (srcset) {
        const candidates = srcset
          .split(",")
          .map((part) => part.trim().split(/\s+/))
          .map(([u, w]) => ({
            url: u,
            width: parseInt((w || "0").replace(/\D/g, "")) || 0,
          }));
        candidates.sort((a, b) => b.width - a.width);
        if (candidates.length > 0) src = candidates[0].url;
      }
    }

    if (!src) src = img.attr("data-cfsrc") || "";
    if (!src) src = img.attr("data-manga-src") || "";
    if (!src) src = img.attr("src") || "";

    src = src.trim();
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }

  protected parseStatus(status: string): string {
    const s = status.toLowerCase().trim();
    if (s.includes("complet")) return "Completed";
    if (
      s.includes("ongoing") ||
      s.includes("on going") ||
      s.includes("publishing")
    )
      return "Ongoing";
    if (s.includes("hold") || s.includes("hiatus")) return "Hiatus";
    if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
    return "Unknown";
  }

  protected parseDate(dateText: string): Date {
    if (!dateText) return new Date();
    const direct = new Date(dateText);
    if (!isNaN(direct.getTime())) return direct;

    const now = new Date();
    const lower = dateText.toLowerCase();
    if (lower.includes("ago")) {
      const amount = parseInt(lower.match(/\d+/)?.[0] || "0");
      if (lower.includes("min")) return new Date(now.getTime() - amount * 60000);
      if (lower.includes("hour"))
        return new Date(now.getTime() - amount * 3600000);
      if (lower.includes("day"))
        return new Date(now.getTime() - amount * 86400000);
      if (lower.includes("week"))
        return new Date(now.getTime() - amount * 604800000);
      if (lower.includes("month"))
        return new Date(now.getTime() - amount * 2592000000);
      if (lower.includes("year"))
        return new Date(now.getTime() - amount * 31536000000);
    }
    return now;
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
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }
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
