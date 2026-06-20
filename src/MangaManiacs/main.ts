import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaManiacs = new MadaraExtension({
  name: "MangaManiacs",
  baseUrl: "https://mangamaniacs.org",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
