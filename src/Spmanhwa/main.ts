import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Spmanhwa = new MadaraExtension({
  name: "Spmanhwa",
  baseUrl: "https://spmanhwa.online",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
