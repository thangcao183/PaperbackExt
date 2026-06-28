import {
  ContentRating,
  DiscoverSection,
  DiscoverSectionItem,
  Metadata,
  PagedResults,
  SearchQuery,
  SearchResultItem,
  SortingOption,
} from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";
import { MadaraSearchMeta } from "../utils/madara/forms";

// Local mirror of the template's private pagination metadata shape, used only
// to read/write the values that the base methods round-trip through metadata.
type GEDEComixMetadata = {
  page?: number;
  collectedIds?: string[];
  searchCollectedIds?: string[];
};

/**
 * GEDE Comix is a generic Madara site, but upstream (keiyoushi) overrides
 * `popularMangaFromElement` and `searchMangaFromElement` so that each list
 * thumbnail is re-read from `img:not([data-eio])` within the entry. The theme
 * ships a placeholder/lazy image carrying a `data-eio` attribute next to the
 * real cover; the base Madara behavior of grabbing the first `img` would pick
 * the wrong element. Both upstream overrides are otherwise identical to the
 * base (anchor + thumbnail extraction), so the only faithful change here is
 * the image selector: `img` -> `img:not([data-eio])`.
 *
 * The popular and search methods below mirror the template's logic exactly so
 * that load-more pagination and advanced search filters keep working; only the
 * thumbnail selector differs.
 */
class GEDEComixExtension extends MadaraExtension {
  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "new_series":
        return this.getMangaList(metadata, "new-manga", "featuredCarouselItem");
      case "recently_updated":
        return this.getMangaList(metadata, "latest", "simpleCarouselItem");
      case "currently_trending":
        return this.getMangaList(metadata, "trending", "simpleCarouselItem");
      case "most_popular":
        return this.getMangaList(metadata, "views", "simpleCarouselItem");
      default:
        return { items: [] };
    }
  }

  private async getMangaList(
    metadata: Metadata | undefined,
    orderBy: "views" | "latest" | "trending" | "new-manga",
    itemType: "featuredCarouselItem" | "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as GEDEComixMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    let $;
    if (this.useLoadMoreRequest) {
      $ = await this.fetchCheerio({
        url: `${this.baseUrl}/wp-admin/admin-ajax.php`,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          referer: `${this.baseUrl}/`,
        },
        body: this.loadMoreBody(page, orderBy),
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
      // Upstream override: prefer the cover image, skipping the data-eio one.
      const image = this.imageFromElement(
        unit.find("img:not([data-eio])").first(),
      );

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

    const hasNextPage = this.useLoadMoreRequest
      ? items.length > 0
      : $("div.nav-previous, nav.navigation-ajax, a.nextpostslink").length > 0;

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  override async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as GEDEComixMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.searchCollectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    const searchMeta = (
      query.metadata as { searchMeta?: MadaraSearchMeta } | undefined
    )?.searchMeta;

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

    const browseAll = !titleQuery && !hasFilters;

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

    const itemSelector = browseAll
      ? "div.page-item-detail, .manga__item"
      : "div.c-tabs-item__content, .manga__item";

    $(itemSelector).each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find(this.searchMangaUrlSelector).first();
      const title = titleLink.text().trim() || titleLink.attr("title") || "";
      const href = titleLink.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      // Upstream override: prefer the cover image, skipping the data-eio one.
      const image = this.imageFromElement(
        unit.find("img:not([data-eio])").first(),
      );

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
    const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit
          ? { page: page + 1, searchCollectedIds: collectedIds }
          : undefined,
    };
  }
}

export const GEDEComix = new GEDEComixExtension({
  name: "GEDE Comix",
  baseUrl: "https://gedecomix.com",
  mangaSubString: "porncomic",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  mangaDetailsThumbnailSelector: "div.summary_image img:not([data-eio])",
});
