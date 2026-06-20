import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const GingeRTooN = new MadaraExtension({
  name: "GingeRTooN",
  baseUrl: "https://gingertoon.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
