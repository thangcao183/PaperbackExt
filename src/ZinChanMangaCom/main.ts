import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ZinChanMangaCom = new MadaraExtension({
  name: "ZinChanManga.com",
  baseUrl: "https://zinchangmanga.net",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
