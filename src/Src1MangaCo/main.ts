import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";

export const Src1MangaCo = new MangaHubExtension({
  name: "1Manga.co",
  baseUrl: "https://1manga.co",
  mangaSource: "mn03",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
