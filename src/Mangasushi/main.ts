import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Mangasushi = new MadaraExtension({
  name: "Mangasushi",
  baseUrl: "https://mangasushi.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
