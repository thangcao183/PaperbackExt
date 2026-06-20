import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const EvaScans = new MangaThemesiaExtension({
  name: "Eva Scans",
  baseUrl: "https://evascans.org",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
