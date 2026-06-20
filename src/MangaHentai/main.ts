import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaHentai = new MadaraExtension({
  name: "Manga Hentai",
  baseUrl: "https://mangahentai.me",
  mangaSubString: "manga-hentai",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
