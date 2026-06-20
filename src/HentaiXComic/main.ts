import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const HentaiXComic = new MadaraExtension({
  name: "HentaiXComic",
  baseUrl: "https://hentaixcomic.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
