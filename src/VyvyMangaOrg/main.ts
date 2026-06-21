import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const VyvyMangaOrg = new MadaraExtension({
  name: "VyvyManga.org",
  baseUrl: "https://vyvymanga.org",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  useLoadMoreRequest: true,
});
