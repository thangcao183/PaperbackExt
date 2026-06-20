import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const NoxenScans = new MangaThemesiaExtension({
  name: "Noxen Scans",
  baseUrl: "https://noxenscan.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
