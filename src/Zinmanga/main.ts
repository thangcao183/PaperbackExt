import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Zinmanga = new MadaraExtension({
  name: "Zinmanga",
  baseUrl: "https://mangazin.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
