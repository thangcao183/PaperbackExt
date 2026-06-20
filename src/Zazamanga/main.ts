import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Zazamanga = new MadaraExtension({
  name: "Zazamanga",
  baseUrl: "https://zazamanga.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
