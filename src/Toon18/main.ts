import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Toon18 = new MadaraExtension({
  name: "Toon18",
  baseUrl: "https://toon18.to",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
