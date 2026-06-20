import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaFastNetUnoriginal = new MadaraExtension({
  name: "ManhuaFast.net (unoriginal)",
  baseUrl: "https://manhuafast.net",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
