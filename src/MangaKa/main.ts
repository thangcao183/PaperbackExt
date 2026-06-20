import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaKa = new MadaraExtension({
  name: "MangaKa",
  baseUrl: "https://mangaka.cc",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
