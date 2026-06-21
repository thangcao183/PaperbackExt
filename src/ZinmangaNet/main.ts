import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ZinmangaNet = new MadaraExtension({
  name: "Zinmanga.net",
  baseUrl: "https://zinmanga.net",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  filterNonMangaItems: false,
});
