import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const ComicAsura = new MangaThemesiaExtension({
  name: "Comic Asura",
  baseUrl: "https://comicasura.net",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
