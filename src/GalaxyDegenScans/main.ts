import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const GalaxyDegenScans = new MadaraExtension({
  name: "GalaxyDegenScans",
  baseUrl: "https://gdscans.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
