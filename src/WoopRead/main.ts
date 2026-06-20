import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const WoopRead = new MadaraExtension({
  name: "WoopRead",
  baseUrl: "https://woopread.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
