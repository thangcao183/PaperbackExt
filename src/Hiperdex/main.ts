import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Hiperdex = new MadaraExtension({
  name: "Hiperdex",
  baseUrl: "https://hiperdex.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
