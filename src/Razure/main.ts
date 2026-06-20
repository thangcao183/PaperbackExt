import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const Razure = new MangaThemesiaExtension({
  name: "Razure",
  baseUrl: "https://razure.org",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
