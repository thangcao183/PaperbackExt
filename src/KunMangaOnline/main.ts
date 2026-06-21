import {
  Chapter,
  ContentRating,
  DiscoverSection,
  DiscoverSectionItem,
  Metadata,
  PagedResults,
  SearchQuery,
  SearchResultItem,
  SortingOption,
  SourceManga,
} from "@paperback/types";
import { CheerioAPI } from "cheerio";
import { MadaraExtension } from "../utils/madara/template";

const POSTS_PER_PAGE = 20;
const CHAPTERS_PER_PAGE = 50;

// Upstream Order By filter values (KMoOrderByFilter).
const ORDER_BY_VALUES: Record<string, string> = {
  latest: "latest",
  alphabet: "alphabet",
  rating: "rating",
  trending: "trending",
  views: "views",
  "new-manga": "new-manga",
};

type KunMangaMetadata = {
  page?: number;
  collectedIds?: string[];
};

// JSON chapter API shapes.
type ChapterDto = {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string | null;
};

type ChapterListResponse = {
  data: {
    chapters: ChapterDto[];
    last_page: number;
  };
};

class KunMangaOnlineExtension extends MadaraExtension {
  // ----------------------------------------------------------------
  // Discover (Popular + Latest) — upstream popularMangaParse /
  // latestUpdatesParse both delegate to parseMangaCards over custom
  // request URLs.
  // ----------------------------------------------------------------

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as KunMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    let url: string;
    let isAjax = false;
    let itemType: "featuredCarouselItem" | "simpleCarouselItem";

    switch (section.id) {
      case "popular_section":
        // popularMangaRequest
        url =
          page > 1
            ? `${this.baseUrl}/page/${page}/?orderby=views&post_type=wp-manga`
            : `${this.baseUrl}/?orderby=views&post_type=wp-manga`;
        itemType = "featuredCarouselItem";
        break;
      case "latest_section": {
        // latestUpdatesRequest — custom madara_load_more GET (page is 0-indexed
        // in the `page` param, 1-indexed in vars[paged]).
        const params: [string, string][] = [
          ["action", "madara_load_more"],
          ["page", (page - 1).toString()],
          ["template", "madara-core/content/content-archive"],
          ["vars[orderby]", "meta_value_num"],
          ["vars[paged]", page.toString()],
          ["vars[timerange]", ""],
          ["vars[posts_per_page]", POSTS_PER_PAGE.toString()],
          ["vars[tax_query][relation]", "OR"],
          ["vars[meta_query][0][relation]", "AND"],
          ["vars[meta_query][relation]", "AND"],
          ["vars[post_type]", "wp-manga"],
          ["vars[post_status]", "publish"],
          ["vars[meta_key]", "_latest_update"],
          ["vars[order]", "desc"],
          ["vars[sidebar]", "right"],
          ["vars[manga_archives_item_layout]", "big_thumbnail"],
          ["_", Date.now().toString()],
        ];
        const query = params
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("&");
        url = `${this.baseUrl}/?${query}`;
        isAjax = true;
        itemType = "simpleCarouselItem";
        break;
      }
      default:
        return { items: [] };
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const cards = this.parseMangaCards($, collectedIds);

    const items: DiscoverSectionItem[] = cards.map((card) => ({
      type: itemType,
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      metadata: undefined,
    }));

    const hasNextPage = isAjax
      ? cards.length >= POSTS_PER_PAGE
      : this.hasNextPaginationLink($);

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Search — searchMangaRequest builds a custom URL; searchMangaParse
  // delegates to parseMangaCards.
  // ----------------------------------------------------------------

  override async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as KunMangaMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    const searchMeta = (
      query.metadata as
        | {
            searchMeta?: {
              author?: string;
              artist?: string;
              release?: string;
              status?: string[];
              orderBy?: string[];
              adult?: string[];
              genreCondition?: string[];
              genres?: string[];
            };
          }
        | undefined
    )?.searchMeta;

    const base = page > 1 ? `${this.baseUrl}/page/${page}/` : this.baseUrl;
    const params: [string, string][] = [];

    if (titleQuery.length > 0) {
      params.push(["s", titleQuery]);
    }
    params.push(["post_type", "wp-manga"]);

    if (searchMeta) {
      if (searchMeta.author) params.push(["author", searchMeta.author]);
      if (searchMeta.artist) params.push(["artist", searchMeta.artist]);
      if (searchMeta.release) params.push(["release", searchMeta.release]);

      // OperatorFilter: "" (OR) or "1" (AND).
      if (
        searchMeta.genreCondition &&
        searchMeta.genreCondition.length > 0 &&
        searchMeta.genreCondition[0] !== ""
      ) {
        params.push(["op", searchMeta.genreCondition[0]]);
      }

      // AdultFilter.
      if (
        searchMeta.adult &&
        searchMeta.adult.length > 0 &&
        searchMeta.adult[0] !== ""
      ) {
        params.push(["adult", searchMeta.adult[0]]);
      }

      // Status checkboxes -> status[].
      if (searchMeta.status) {
        for (const s of searchMeta.status) {
          if (s) params.push(["status[]", s]);
        }
      }

      // Genre checkboxes -> genre[].
      if (searchMeta.genres) {
        for (const g of searchMeta.genres) {
          if (g) params.push(["genre[]", g]);
        }
      }
    }

    // KMoOrderByFilter / sorting dropdown -> orderby.
    const filterOrderBy =
      searchMeta?.orderBy && searchMeta.orderBy.length > 0
        ? searchMeta.orderBy[0]
        : "";
    const sortId = sortingOption?.id ?? "";
    const effectiveOrderBy = ORDER_BY_VALUES[sortId] ?? filterOrderBy;
    if (effectiveOrderBy) {
      params.push(["orderby", effectiveOrderBy]);
    }

    const query2 = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const url = query2.length > 0 ? `${base}?${query2}` : base;

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const cards = this.parseMangaCards($, collectedIds);

    const items: SearchResultItem[] = cards.map((card) => ({
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      subtitle: undefined,
      metadata: undefined,
    }));

    const hasNextPage = this.hasNextPaginationLink($);
    const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;

    return {
      items,
      metadata:
        hasNextPage && !reachedPageLimit
          ? { page: page + 1, collectedIds }
          : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Chapters — custom paginated JSON API at
  // /api/comics/{slug}/chapters. (fetchChapterList +
  // chapterListParse/Request throw upstream.)
  // ----------------------------------------------------------------

  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = sourceManga.mangaId;
    const chapters: Chapter[] = [];

    let currentPage = 1;
    let lastPage = 1;

    do {
      const apiUrl = `${this.baseUrl}/api/comics/${slug}/chapters?page=${currentPage}&per_page=${CHAPTERS_PER_PAGE}&order=desc`;
      const [, data] = await Application.scheduleRequest({
        url: apiUrl,
        method: "GET",
        headers: { accept: "application/json" },
      });
      const json = JSON.parse(
        Application.arrayBufferToUTF8String(data),
      ) as ChapterListResponse;

      lastPage = json.data.last_page;

      for (const dto of json.data.chapters) {
        const chapterSlug = dto.chapter_slug;
        // Upstream url = "/manga/$slug/$chapterSlug"; chapterId is the segment
        // after the manga slug.
        const chapterId = this.toSafeId(chapterSlug);

        const chapterTitle = dto.chapter_name;
        let chapNum = 0;
        const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
        if (numMatch) {
          chapNum = parseFloat(numMatch[1]);
        } else {
          const slugMatch = chapterSlug.match(/chapter-(\d+(?:[.-]\d+)?)/i);
          if (slugMatch) chapNum = parseFloat(slugMatch[1].replace("-", "."));
        }

        chapters.push({
          chapterId,
          sourceManga,
          title: chapterTitle,
          volume: 0,
          chapNum,
          publishDate: this.parseApiDate(dto.updated_at),
          langCode: this.langCode,
        });
      }

      currentPage++;
    } while (currentPage <= lastPage);

    return chapters;
  }

  // ----------------------------------------------------------------
  // Shared helpers
  // ----------------------------------------------------------------

  // Upstream parseMangaCards.
  private parseMangaCards(
    $: CheerioAPI,
    collectedIds: string[],
  ): { mangaId: string; title: string; imageUrl: string }[] {
    const baseHost = this.hostOf(this.baseUrl);
    const out: { mangaId: string; title: string; imageUrl: string }[] = [];

    $(".c-tabs-item__content, .page-item-detail").each((_, element) => {
      const el = $(element);
      const titleEl = el.find(".post-title a, h3.h4 a").first();
      if (titleEl.length === 0) return;

      // ownText(): text of the anchor excluding child elements.
      const title = this.ownText(titleEl);
      const href = titleEl.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      if (!title || !mangaId || collectedIds.includes(mangaId)) return;

      const img = el.find("img").first();
      let imageUrl = "";
      for (const attr of [
        "data-backup",
        "src",
        "data-src",
        "data-lazy-src",
        "data-aload",
      ]) {
        const candidate = (img.attr(attr) || "").trim();
        if (
          candidate.startsWith("http") &&
          !candidate.includes(`${baseHost}/thumb`)
        ) {
          imageUrl = candidate;
          break;
        }
      }

      collectedIds.push(mangaId);
      out.push({ mangaId, title, imageUrl });
    });

    return out;
  }

  // Upstream non-AJAX hasNextPage check.
  private hasNextPaginationLink($: CheerioAPI): boolean {
    return (
      $(
        "a[aria-label=Next], .nav-previous, .next.page-numbers, .pagination-next, .wp-pagenavi .next, a[rel=next], .next",
      ).length > 0
    );
  }

  // Jsoup ownText(): direct text nodes of the element only.
  private ownText(el: ReturnType<CheerioAPI>): string {
    return el
      .first()
      .contents()
      .filter((_, n) => n.type === "text")
      .text()
      .trim();
  }

  // apiDateFormat: yyyy-MM-dd'T'HH:mm:ss (UTC), parsed from the value before
  // the first '.'.
  private parseApiDate(value?: string | null): Date {
    if (!value) return new Date(0);
    const trimmed = value.split(".")[0];
    // Treat the timestamp as UTC.
    const parsed = new Date(`${trimmed}Z`);
    if (isNaN(parsed.getTime())) return new Date(0);
    return parsed;
  }

  private hostOf(url: string): string {
    const match = url.match(/^https?:\/\/([^/]+)/i);
    return match ? match[1] : url;
  }
}

export const KunMangaOnline = new KunMangaOnlineExtension({
  name: "Kun Manga Online",
  baseUrl: "https://www.kunmanga.online",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
