import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manhwa18Org = new MadaraExtension({
  name: "Manhwa18.org",
  baseUrl: "https://manhwa18.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
