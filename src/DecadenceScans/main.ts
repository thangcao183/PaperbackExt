import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const DecadenceScans = new MadaraExtension({
  name: "Decadence Scans",
  baseUrl: "https://reader.decadencescans.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
