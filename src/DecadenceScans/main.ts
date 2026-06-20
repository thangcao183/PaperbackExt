import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const source = new MadaraExtension({
  name: "Decadence Scans",
  baseUrl: "https://reader.decadencescans.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
