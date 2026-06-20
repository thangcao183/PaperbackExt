import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const RizzComic = new MangaThemesiaExtension({
  name: "Rizz Comic",
  baseUrl: "https://rizzfables.com",
  mangaUrlDirectory: "/series",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
