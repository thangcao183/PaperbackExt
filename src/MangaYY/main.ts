import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaYY = new MadaraExtension({
  name: "MangaYY",
  baseUrl: "https://mangayy.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
