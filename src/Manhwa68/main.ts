import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manhwa68 = new MadaraExtension({
  name: "Manhwa68",
  baseUrl: "https://manhwa68.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
