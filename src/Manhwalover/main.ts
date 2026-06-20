import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const Manhwalover = new MangaThemesiaExtension({
  name: "Manhwalover",
  baseUrl: "https://www.manhwalover.org",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
