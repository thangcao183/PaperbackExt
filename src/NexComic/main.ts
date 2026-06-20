import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const NexComic = new MangaThemesiaExtension({
  name: "NexComic",
  baseUrl: "https://nexcomic.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
