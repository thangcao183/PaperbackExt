import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const RestScans = new MangaThemesiaExtension({
  name: "Rest Scans",
  baseUrl: "https://restscans.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
