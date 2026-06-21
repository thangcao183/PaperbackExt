import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Utoon = new MadaraExtension({
  name: "Utoon",
  baseUrl: "https://utoon.net",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  useLoadMoreRequest: true,
});
