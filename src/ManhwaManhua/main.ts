import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhwaManhua = new MadaraExtension({
  name: "ManhwaManhua",
  baseUrl: "https://manhwamanhua.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
