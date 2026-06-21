import {
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
import { MadaraExtension } from "../utils/madara/template";

/**
 * Upstream (keiyoushi) overrides popularMangaFromElement, searchMangaFromElement
 * and mangaDetailsParse to replace the parsed title with one derived from the
 * manga URL slug: the segment after `/manga/`, with dashes turned into spaces
 * and each word capitalized. Reproduced here against the Paperback mangaId,
 * which is exactly that slug.
 */
class ZinChanMangaComExtension extends MadaraExtension {
  /** Mirror of upstream `String.urlToTitle()`: slug -> "Title Case". */
  private slugToTitle(mangaId: string): string | undefined {
    const slug = this.safeDecode(mangaId);
    if (!slug) return undefined;

    let result = "";
    let capitalize = true;
    for (const char of slug) {
      if (char === "-") {
        result += " ";
      } else if (capitalize) {
        result += char.toUpperCase();
      } else {
        result += char.toLowerCase();
      }
      capitalize = char === "-";
    }
    return result;
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const result = await super.getDiscoverSectionItems(section, metadata);
    return {
      ...result,
      items: result.items.map((item) =>
        "mangaId" in item && "title" in item
          ? { ...item, title: this.slugToTitle(item.mangaId) ?? item.title }
          : item,
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
      items: result.items.map((item) =>
        "mangaId" in item && "title" in item
          ? { ...item, title: this.slugToTitle(item.mangaId) ?? item.title }
          : item,
      ),
    };
  }

  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const result = await super.getMangaDetails(mangaId);
    const title = this.slugToTitle(mangaId);
    if (!title) return result;
    return {
      ...result,
      mangaInfo: {
        ...result.mangaInfo,
        primaryTitle: title,
      },
    };
  }
}

export const ZinChanMangaCom = new ZinChanMangaComExtension({
  name: "ZinChanManga.com",
  baseUrl: "https://zinchangmanga.net",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
