import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const HentaiDex = new MangaThemesiaExtension({
  name: "HentaiDex",
  baseUrl: "https://dexhentai.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
