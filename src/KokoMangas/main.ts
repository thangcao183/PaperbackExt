import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const KokoMangas = new MadaraExtension({
  name: "KokoMangas",
  baseUrl: "https://kokomangas.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  useLoadMoreRequest: true,
});
