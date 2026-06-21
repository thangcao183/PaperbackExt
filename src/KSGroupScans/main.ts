import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const KSGroupScans = new MadaraExtension({
  name: "KSGroupScans",
  baseUrl: "https://ksgroupscans.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
