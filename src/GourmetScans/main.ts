import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const GourmetScans = new MadaraExtension({
  name: "Gourmet Scans",
  baseUrl: "https://gourmetsupremacy.com",
  mangaSubString: "project",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  // Upstream `chapterFromElement` strips `?style=list` from chapter URLs
  // (`url = this.url.substringBefore("?style=list")`). Dropping the suffix
  // reproduces that faithfully.
  chapterUrlSuffix: "",
});
