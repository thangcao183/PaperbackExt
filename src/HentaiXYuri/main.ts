import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const HentaiXYuri = new MadaraExtension({
  name: "HentaiXYuri",
  baseUrl: "https://hentaixyuri.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
