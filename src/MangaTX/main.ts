import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const MangaTX = new MangaThemesiaExtension({
  name: "MangaTX",
  baseUrl: "https://mangatx.cc",
  mangaUrlDirectory: "/manga-list",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
