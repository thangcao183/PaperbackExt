import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Firescans = new MadaraExtension({
  name: "Firescans",
  baseUrl: "https://firescans.xyz",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
