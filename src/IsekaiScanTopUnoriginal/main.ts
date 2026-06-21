import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const IsekaiScanTopUnoriginal = new MadaraExtension({
  name: "IsekaiScan.top (unoriginal)",
  baseUrl: "https://isekaiscan.top",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
