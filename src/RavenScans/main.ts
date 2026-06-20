import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const RavenScans = new MangaThemesiaExtension({
  name: "Raven Scans",
  baseUrl: "https://ravenscans.org",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
