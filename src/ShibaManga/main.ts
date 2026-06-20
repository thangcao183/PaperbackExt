import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ShibaManga = new MadaraExtension({
  name: "Shiba Manga",
  baseUrl: "https://shibamanga.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
