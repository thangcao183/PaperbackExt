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

class ZinChanMangaExtension extends MadaraExtension {
  /**
   * Upstream derives the title from the manga URL slug (the segment after
   * `/manga/`, before the next `/`): hyphens become spaces and each word is
   * title-cased. The Paperback `mangaId` already holds that slug (it is
   * extracted by `parseMangaId`), so we run the same transform on the decoded
   * id. Returns undefined when the slug is blank, matching the upstream
   * `?: return null` so the original title is kept as a fallback.
   */
  private slugToTitle(mangaId: string): string | undefined {
    const slug = this.safeDecode(mangaId);
    if (!slug.trim()) return undefined;

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
    const manga = await super.getMangaDetails(mangaId);
    return {
      ...manga,
      mangaInfo: {
        ...manga.mangaInfo,
        primaryTitle:
          this.slugToTitle(mangaId) ?? manga.mangaInfo.primaryTitle,
      },
    };
  }
}

export const ZinChanManga = new ZinChanMangaExtension({
  name: "ZinChanManga",
  baseUrl: "https://zinchangmanga.net",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
