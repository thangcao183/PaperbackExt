import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ZinChanManga = new MadaraExtension({
  name: "ZinChanManga",
  baseUrl: "https://zinchangmanga.net",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
