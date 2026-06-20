import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const LHTranslation = new MadaraExtension({
  name: "LHTranslation",
  baseUrl: "https://lhtranslation.net",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
