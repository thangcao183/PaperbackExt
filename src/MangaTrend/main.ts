import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const MangaTrend = new MangaThemesiaExtension({
  name: "Manga Trend",
  baseUrl: "https://mangatrend.org",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
