import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const AquaManga = new MadaraExtension({
  name: "Aqua Manga",
  baseUrl: "https://aquareader.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
