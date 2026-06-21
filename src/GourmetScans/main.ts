import {
  ContentRating,
  Metadata,
  PagedResults,
  SearchQuery,
  SearchResultItem,
  SortingOption,
} from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";

type GourmetScansSearchMeta = {
  page?: number;
  collectedIds?: string[];
};

class GourmetScansExtension extends MadaraExtension {
  // Upstream `searchMangaRequest` builds a path-based browse URL driven by
  // filters and ignores the text query entirely. With no upstream year/genre
  // filter set (the `else` branch), it browses `/{mangaSubString}` with an
  // optional `m_orderby` and the paginated `searchPage(page)` suffix
  // (page 1 -> "", else "page/{page}"). It parses results with the custom
  // selectors `.page-listing-item .page-item-detail` and detects more pages
  // with `.navigation-ajax > #navigation-ajax`.
  override async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as GourmetScansSearchMeta | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const builder = new URLBuilder(this.baseUrl).addPath(this.mangaSubString);

    // searchPage(page): page 1 has no extra segment, otherwise `page/{page}`.
    if (page > 1) {
      builder.addPath("page").addPath(page.toString());
    }

    const orderBy = sortingOption?.id ?? "";
    if (orderBy) {
      builder.addQuery("m_orderby", orderBy);
    }

    const url = builder.build();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const results: SearchResultItem[] = [];
    $(".page-listing-item .page-item-detail").each((_, element) => {
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
      $(".navigation-ajax > #navigation-ajax").length > 0;
    const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit
          ? { page: page + 1, collectedIds }
          : undefined,
    };
  }
}

export const GourmetScans = new GourmetScansExtension({
  name: "Gourmet Scans",
  baseUrl: "https://gourmetsupremacy.com",
  mangaSubString: "project",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  // Upstream `chapterFromElement` strips `?style=list` from chapter URLs
  // (`url = this.url.substringBefore("?style=list")`). Dropping the suffix
  // reproduces that faithfully.
  chapterUrlSuffix: "",
});
