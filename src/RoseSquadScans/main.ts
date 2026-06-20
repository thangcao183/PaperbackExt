import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const RoseSquadScans = new MadaraExtension({
  name: "Rose Squad Scans",
  baseUrl: "https://rosesquadscans.aishiteru.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
