import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const WoopRead = new MadaraExtension({
  name: "WoopRead",
  baseUrl: "https://woopread.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
