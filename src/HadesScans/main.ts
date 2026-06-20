import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const HadesScans = new MangaThemesiaExtension({
  name: "Hades Scans",
  baseUrl: "https://hadesscans.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
