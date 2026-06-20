import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const NovelCrow = new MadaraExtension({
  name: "NovelCrow",
  baseUrl: "https://novelcrow.com",
  mangaSubString: "comic",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
