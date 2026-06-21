import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaReadOrg = new MadaraExtension({
  name: "MangaRead.org",
  baseUrl: "https://www.mangaread.org",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
