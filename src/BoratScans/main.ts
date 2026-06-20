import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const BoratScans = new MadaraExtension({
  name: "Borat Scans",
  baseUrl: "https://boratscans.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
