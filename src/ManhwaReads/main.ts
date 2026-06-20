import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhwaReads = new MadaraExtension({
  name: "Manhwa Reads",
  baseUrl: "https://manhwareads.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
