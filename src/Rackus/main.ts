import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const Rackus = new MangaThemesiaExtension({
  name: "Rackus",
  baseUrl: "https://rackusreads.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
