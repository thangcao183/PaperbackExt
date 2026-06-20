import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const RDScans = new MadaraExtension({
  name: "RD Scans",
  baseUrl: "https://rdscans.com",
  mangaSubString: "new",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
