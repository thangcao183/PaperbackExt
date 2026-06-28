import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const AquaManga = new MadaraExtension({
  name: "Aqua Manga",
  baseUrl: "https://aquareader.org",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  chapterUrlSuffix: "",
  // Aqua uses a custom theme; its listing items aren't the standard Madara
  // `div.page-item-detail` so the discover carousel was empty.
  discoverItemSelector: "article.aqua-archive-card",
  popularMangaUrlSelector: "h3.aqua-archive-card__title a",
  // The detail page also uses a custom theme: title/cover/status/synopsis live
  // under `.aqua-series-*` classes and the chapter rows are bare
  // `a.aqua-ch-item` anchors (handled by the template's anchor-as-row logic).
  mangaDetailsTitleSelector: ".aqua-series-info__title",
  mangaDetailsThumbnailSelector: ".aqua-series-cover__img",
  mangaDetailsStatusSelector: ".aqua-series-meta__status",
  mangaDetailsDescriptionSelector: ".aqua-series-synopsis",
  chapterListSelector: "a.aqua-ch-item",
});
