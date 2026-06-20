import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const source = new MadaraExtension({
  name: "TopManhua.fan",
  baseUrl: "https://www.topmanhua.fan",
  mangaSubString: "manhua",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
