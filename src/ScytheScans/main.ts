import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const ScytheScans = new MangaThemesiaExtension({
  name: "Scythe Scans",
  baseUrl: "https://scythescans.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
