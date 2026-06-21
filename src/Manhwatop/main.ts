import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manhwatop = new MadaraExtension({
  name: "Manhwatop",
  baseUrl: "https://manhwatop.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  filterNonMangaItems: false,
});
