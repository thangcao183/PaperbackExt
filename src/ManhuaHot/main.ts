import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaHot = new MadaraExtension({
  name: "ManhuaHot",
  baseUrl: "https://manhuahot.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
