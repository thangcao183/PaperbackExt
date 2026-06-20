import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const ManhuascanUs = new MangaThemesiaExtension({
  name: "Manhuascan.us",
  baseUrl: "https://manhuascan.us",
  mangaUrlDirectory: "/manga-list",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
