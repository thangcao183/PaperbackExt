import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const AkazaScans = new MangaThemesiaExtension({
  name: "Akaza Scans",
  baseUrl: "https://akazascans.org",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
