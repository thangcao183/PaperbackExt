import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const S2Manga = new MadaraExtension({
  name: "S2Manga",
  baseUrl: "https://s2read.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
