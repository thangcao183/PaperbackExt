import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ResetScans = new MadaraExtension({
  name: "Reset Scans",
  baseUrl: "https://reset-scans.org",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
