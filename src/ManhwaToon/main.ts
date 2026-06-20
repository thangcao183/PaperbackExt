import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhwaToon = new MadaraExtension({
  name: "Manhwa Toon",
  baseUrl: "https://www.manhwatoon.me",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
