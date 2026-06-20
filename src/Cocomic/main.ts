import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Cocomic = new MadaraExtension({
  name: "Cocomic",
  baseUrl: "https://cocomic.co",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
