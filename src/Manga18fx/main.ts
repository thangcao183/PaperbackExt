import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manga18fx = new MadaraExtension({
  name: "Manga18fx",
  baseUrl: "https://manga18fx.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
