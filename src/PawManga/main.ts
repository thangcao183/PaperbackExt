import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const PawManga = new MadaraExtension({
  name: "Paw Manga",
  baseUrl: "https://pawmanga.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
