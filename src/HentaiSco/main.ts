import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const HentaiSco = new MadaraExtension({
  name: "HentaiSco",
  baseUrl: "https://hentaisco.cc",
  mangaSubString: "hentai",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
