import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const WebtoonXYZ = new MadaraExtension({
  name: "WebtoonXYZ",
  baseUrl: "https://www.webtoon.xyz",
  mangaSubString: "read",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
