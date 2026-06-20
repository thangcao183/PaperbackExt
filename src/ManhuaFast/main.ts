import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaFast = new MadaraExtension({
  name: "ManhuaFast",
  baseUrl: "https://manhuafast.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
