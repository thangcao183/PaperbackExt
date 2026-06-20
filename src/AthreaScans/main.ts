import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const AthreaScans = new MangaThemesiaExtension({
  name: "Athrea Scans",
  baseUrl: "https://athreascans.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
