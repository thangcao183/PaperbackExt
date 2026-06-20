import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaDass = new MadaraExtension({
  name: "Manga Dass",
  baseUrl: "https://mangadass.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
