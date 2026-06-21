import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const TopManhua = new MadaraExtension({
  name: "Top Manhua",
  baseUrl: "https://mangatop.org",
  mangaSubString: "manhua",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  filterNonMangaItems: false,
});
