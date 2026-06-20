import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";

export const MangaToday = new MangaHubExtension({
  name: "MangaToday",
  baseUrl: "https://mangatoday.fun",
  mangaSource: "m03",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
