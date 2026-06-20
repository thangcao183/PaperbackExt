import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manhwatop = new MadaraExtension({
  name: "Manhwatop",
  baseUrl: "https://manhwatop.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
