import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";

export const MangakakalotFun = new MangaHubExtension({
  name: "Mangakakalot.fun",
  baseUrl: "https://mangakakalot.fun",
  mangaSource: "mn01",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
