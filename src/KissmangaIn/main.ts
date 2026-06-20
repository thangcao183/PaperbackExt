import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const KissmangaIn = new MadaraExtension({
  name: "Kissmanga.in",
  baseUrl: "https://kissmanga.in",
  mangaSubString: "kissmanga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
