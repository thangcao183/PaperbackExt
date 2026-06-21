import {
  Chapter,
  ContentRating,
  DiscoverSection,
  DiscoverSectionItem,
  DiscoverSectionType,
  Metadata,
  PagedResults,
  SearchQuery,
  SearchResultItem,
  SortingOption,
  SourceManga,
} from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

// The site isn't actually based on Madara but reproduces it very well, so it
// only customises listing/search/chapter parsing on top of the base template.
class Manga18fxExtension extends MadaraExtension {
  // Upstream: popularMangaRequest = GET(baseUrl); popularMangaParse selects the
  // ".trending-block" and maps every <a> via mangaFromElement.
  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "popular_section") {
      const $ = await this.fetchCheerio({ url: this.baseUrl, method: "GET" });
      const items: DiscoverSectionItem[] = [];
      const seen: string[] = [];

      $(".trending-block a").each((_, element) => {
        const link = $(element);
        const href = link.attr("href") || "";
        const mangaId = this.parseMangaId(href);
        const title = link.attr("title") || "";
        const image = this.imageFromElement(link.find("img").first());
        if (title && mangaId && !seen.includes(mangaId)) {
          seen.push(mangaId);
          items.push({
            type: "featuredCarouselItem",
            mangaId,
            imageUrl: image,
            title,
            metadata: undefined,
          });
        }
      });

      return { items, metadata: undefined };
    }

    if (section.id === "latest_section") {
      return this.getLatestItems(metadata, "simpleCarouselItem");
    }

    return { items: [] };
  }

  // Upstream: latestUpdatesRequest = GET("$baseUrl/page/$page");
  // latestUpdatesParse selects ".bsx-item", maps the first <a> of each item,
  // and hasNextPage is derived from a ".next" button that isn't ".disabled".
  private async getLatestItems(
    metadata: Metadata | undefined,
    itemType: "simpleCarouselItem",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const meta = metadata as { page?: number; collectedIds?: string[] } | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];

    const $ = await this.fetchCheerio({
      url: `${this.baseUrl}/page/${page}`,
      method: "GET",
    });

    const items: DiscoverSectionItem[] = [];
    $(".bsx-item").each((_, element) => {
      const link = $(element).find("a").first();
      const href = link.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const title = link.attr("title") || "";
      const image = this.imageFromElement(link.find("img").first());
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

    const nextButton = $(".next").first();
    const hasNextPage =
      nextButton.length > 0 && !nextButton.hasClass("disabled");

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // Upstream: searchMangaRequest -> when query is present GET
  // "$baseUrl/search?q=<query>&page=<page>"; when empty it falls back to the
  // latest-updates listing (genre filters aren't modelled in Paperback's form,
  // so the empty-query path mirrors latestUpdates). searchMangaParse reuses
  // latestUpdatesParse (".bsx-item"). fetchSearchManga also strips a trailing
  // "/" from each manga url; the template's parseMangaId already drops it.
  override async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    _sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as { page?: number; collectedIds?: string[] } | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.collectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    let url: string;
    if (titleQuery.length === 0) {
      url = `${this.baseUrl}/page/${page}`;
    } else {
      url = `${this.baseUrl}/search?q=${encodeURIComponent(titleQuery)}&page=${page}`;
    }

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const items: SearchResultItem[] = [];
    $(".bsx-item").each((_, element) => {
      const link = $(element).find("a").first();
      const href = link.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const title = link.attr("title") || "";
      const image = this.imageFromElement(link.find("img").first());
      if (title && mangaId && !collectedIds.includes(mangaId)) {
        collectedIds.push(mangaId);
        items.push({
          mangaId,
          imageUrl: image,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    const nextButton = $(".next").first();
    const hasNextPage =
      nextButton.length > 0 && !nextButton.hasClass("disabled");

    return {
      items,
      metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // Upstream: chapterListParse selects ".row-content-chapter" and maps its
  // direct children via chapterFromElement (anchor href + text). The chapter
  // date lives in "span.chapter-time" (format "dd MMM yy").
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const mangaUrl = `${this.baseUrl}/${this.mangaSubString}/${mangaId}`;

    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    const container = $(".row-content-chapter").first();
    const chapters: Chapter[] = [];

    container.children().each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterTitle = link.text().trim();
      const chapterId = this.parseChapterId(href, mangaId);
      if (!chapterId) return;

      let chapNum = 0;
      const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const slugMatch = chapterId.match(/chapter-(\d+(?:[.-]\d+)?)/i);
        if (slugMatch) chapNum = parseFloat(slugMatch[1].replace("-", "."));
      }

      const dateText = el.find("span.chapter-time").text().trim();
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

  // Popular is rendered as a single featured block (no pagination), so the
  // discover layout only exposes Popular + Latest Updates.
  override async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular_section",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest_section",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }
}

export const Manga18fx = new Manga18fxExtension({
  name: "Manga18fx",
  baseUrl: "https://manga18fx.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  mangaDetailsDescriptionSelector: ".dsct",
});
