import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const MadaraScans = new MangaThemesiaExtension({
  name: "Madara Scans",
  baseUrl: "https://madarascans.com",
  mangaUrlDirectory: "/series",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
