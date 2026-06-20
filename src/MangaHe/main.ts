import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaHe = new MadaraExtension({
  name: "MangaHe",
  baseUrl: "https://mangahe.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
