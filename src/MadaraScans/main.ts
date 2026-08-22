import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const MadaraScans = new MangaThemesiaExtension({
  name: "Madara Scans",
  baseUrl: "https://madarascans.org",
  mangaUrlDirectory: "/series",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
