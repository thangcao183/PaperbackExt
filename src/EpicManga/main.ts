import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const EpicManga = new MadaraExtension({
  name: "EpicManga",
  baseUrl: "https://epicmanga.co",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
