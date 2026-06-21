import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Src24HNovel = new MadaraExtension({
  name: "24HNovel",
  baseUrl: "https://24hnovel.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
