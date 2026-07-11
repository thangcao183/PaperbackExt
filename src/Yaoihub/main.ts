import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Yaoihub = new MadaraExtension({
  name: "Yaoihub",
  baseUrl: "https://yaoihub.org",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
