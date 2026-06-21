import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaforfreeCom = new MadaraExtension({
  name: "Mangaforfree.com",
  baseUrl: "https://mangaforfree.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
