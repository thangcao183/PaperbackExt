import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ToonGod = new MadaraExtension({
  name: "ToonGod",
  baseUrl: "https://www.toongod.org",
  mangaSubString: "webtoons",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
