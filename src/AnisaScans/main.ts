import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const AnisaScans = new MadaraExtension({
  name: "Anisa Scans",
  baseUrl: "https://anisascans.in",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
