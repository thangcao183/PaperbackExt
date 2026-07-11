import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const Thunderscans = new MangaThemesiaExtension({
  name: "Thunderscans",
  baseUrl: "https://en-thunderscans.com",
  mangaUrlDirectory: "/comics",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  randomUrl: true,
  searchTitleSelector: ".bigor .tt, h3 a",
});
