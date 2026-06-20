import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Paritehaber = new MadaraExtension({
  name: "Paritehaber",
  baseUrl: "https://www.paritehaber.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
