import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const FrierenOnline = new MadaraExtension({
  name: "Frieren Online",
  baseUrl: "https://www.frieren.online",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
