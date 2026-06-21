import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const YakshaComics = new MadaraExtension({
  name: "YakshaComics",
  baseUrl: "https://yakshacomics.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
