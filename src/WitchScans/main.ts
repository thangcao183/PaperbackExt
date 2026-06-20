import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const WitchScans = new MangaThemesiaExtension({
  name: "WitchScans",
  baseUrl: "https://witchscans.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
