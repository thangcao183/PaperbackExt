import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const FableScans = new MangaThemesiaExtension({
  name: "Fable Scans",
  baseUrl: "https://fablescans.com",
  mangaUrlDirectory: "/comic",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
