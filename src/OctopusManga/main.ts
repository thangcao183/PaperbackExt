import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const OctopusManga = new MadaraExtension({
  name: "OctopusManga",
  baseUrl: "https://octopusmanga.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
