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

/**
 * RD Scans applies a custom listing filter on top of the generic Madara
 * behavior: it drops entries whose title contains "(WN)" (web novels) from
 * the popular, latest, and search results. The page list also uses a custom
 * image selector (`div.reading-content .separator img`), which is handled via
 * the `pageListSelector` config knob below.
 */
class RDScansExtension extends MadaraExtension {
  /** Upstream `filterWebNovels`: exclude titles containing "(WN)". */
  private isWebNovel(title: string): boolean {
    return title.toLowerCase().includes("(wn)");
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const result = await super.getDiscoverSectionItems(section, metadata);
    return {
      ...result,
      items: result.items.filter(
        (item) => !this.isWebNovel("title" in item ? (item.title ?? "") : ""),
      ),
    };
  }

  override async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const result = await super.getSearchResults(query, metadata, sortingOption);
    return {
      ...result,
      items: result.items.filter((item) => !this.isWebNovel(item.title ?? "")),
    };
  }
}

export const RDScans = new RDScansExtension({
  name: "RD Scans",
  baseUrl: "https://rdscans.com",
  mangaSubString: "new",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  // Upstream `pageListParse`: pages come from `div.reading-content .separator img`.
  pageListSelector: "div.reading-content .separator img",
});
