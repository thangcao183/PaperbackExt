import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const LinkManga = new MadaraExtension({
  name: "LinkManga",
  baseUrl: "https://linkmanga.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
