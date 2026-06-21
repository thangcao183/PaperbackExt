import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const WebtoonScan = new MadaraExtension({
  name: "WebtoonScan",
  baseUrl: "https://webtoonscan.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
