import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Hentai4Free = new MadaraExtension({
  name: "Hentai4Free",
  baseUrl: "https://hentai4free.net",
  mangaSubString: "hentai",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
