import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaTop = new MadaraExtension({
  name: "ManhuaTop",
  baseUrl: "https://manhuatop.org",
  mangaSubString: "manhua",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
