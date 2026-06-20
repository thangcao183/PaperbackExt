import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Mahouirexnohentaikarte = new MadaraExtension({
  name: "Mahouirexnohentaikarte",
  baseUrl: "https://mahouirexnohentaikarte.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
