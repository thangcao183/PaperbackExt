import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const CoffeeManga = new MadaraExtension({
  name: "Coffee Manga",
  baseUrl: "https://coffeemanga.ink",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
