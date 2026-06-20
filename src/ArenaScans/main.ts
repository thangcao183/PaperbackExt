import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const ArenaScans = new MangaThemesiaExtension({
  name: "Arena Scans",
  baseUrl: "https://arenascan.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
