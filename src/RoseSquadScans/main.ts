import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const RoseSquadScans = new MadaraExtension({
  name: "Rose Squad Scans",
  baseUrl: "https://rosesquadscans.aishiteru.org",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  mangaDetailsStatusSelector: "div.post-content_item:contains(Status) > div.summary-content",
});
