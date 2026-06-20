import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const RokariComics = new MangaThemesiaExtension({
  name: "RokariComics",
  baseUrl: "https://rokaricomics.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
