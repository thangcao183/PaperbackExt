import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Toonizy = new MadaraExtension({
  name: "Toonizy",
  baseUrl: "https://toonizy.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
