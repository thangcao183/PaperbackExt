import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Ero18x = new MadaraExtension({
  name: "Ero18x",
  baseUrl: "https://ero18x.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
