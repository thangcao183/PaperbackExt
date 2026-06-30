import { Chapter, ContentRating, SourceManga } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

// Aqua Manga migrated off the stock Madara markup to a bespoke `.aqua-*`
// theme (keiyoushi PRs #17069 / #17080). Browse cards, detail fields and the
// chapter list all use custom classes. Most of this is expressible through the
// base config selectors, but the chapter rows are `.aqua-ch-item` containers
// whose title and date live in child spans (`.aqua-ch-item__name` /
// `.aqua-ch-item__time`) rather than being the anchor's own text and a
// `span.chapter-release-date` sibling, so `getChapters` is overridden.
class AquaMangaExtension extends MadaraExtension {
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const mangaUrl = this.buildMangaUrl(mangaId);

    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    const chapters: Chapter[] = [];
    $(this.chapterListSelector).each((_, element) => {
      const el = $(element);
      // The `.aqua-ch-item` element is itself the anchor.
      const link = el.is("a") ? el : el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterId = this.parseChapterId(href, mangaId);
      if (!chapterId) return;

      // Title lives in a child span; the element's full text also includes the
      // release-time span, so read the dedicated name node directly.
      const chapterTitle =
        el.find(".aqua-ch-item__name").first().text().trim() ||
        link.text().trim();

      let chapNum = 0;
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

      const dateText = el.find(".aqua-ch-item__time").first().text().trim();
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
}

export const AquaManga = new AquaMangaExtension({
  name: "Aqua Manga",
  baseUrl: "https://aquareader.org",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  chapterUrlSuffix: "",
  // `.aqua-*` browse-card + detail selectors (keiyoushi #17069 / #17080).
  discoverItemSelector: "article.aqua-archive-card",
  popularMangaUrlSelector: "h3.aqua-archive-card__title a",
  searchMangaUrlSelector: "h3.aqua-archive-card__title a",
  mangaDetailsTitleSelector: ".aqua-series-info__title",
  mangaDetailsThumbnailSelector: ".aqua-series-cover__img",
  mangaDetailsStatusSelector: ".aqua-series-meta__status",
  mangaDetailsDescriptionSelector: ".aqua-series-synopsis",
  mangaDetailsAuthorSelector: ".aqua-series-info__creator-value a",
  mangaDetailsArtistSelector: ".aqua-series-info__creator-value a",
  chapterListSelector: ".aqua-ch-item",
});
