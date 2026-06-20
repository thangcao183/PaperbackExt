import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const VioletScans = new MangaThemesiaExtension({
  name: "Violet Scans",
  baseUrl: "https://violetscans.org",
  mangaUrlDirectory: "/comics",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
