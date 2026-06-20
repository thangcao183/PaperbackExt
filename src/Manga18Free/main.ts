import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manga18Free = new MadaraExtension({
  name: "Manga18Free",
  baseUrl: "https://manga18free.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
