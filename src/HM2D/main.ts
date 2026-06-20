import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const HM2D = new MadaraExtension({
  name: "HM2D",
  baseUrl: "https://doujindistrict.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
