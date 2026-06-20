import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const SetsuScans = new MadaraExtension({
  name: "Setsu Scans",
  baseUrl: "https://setsuscans.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
