import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Toonily = new MadaraExtension({
  name: "Toonily",
  baseUrl: "https://toonily.com",
  mangaSubString: "serie",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  useLoadMoreRequest: true,
  filterNonMangaItems: false,
});
