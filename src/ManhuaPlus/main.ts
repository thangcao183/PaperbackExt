import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaPlus = new MadaraExtension({
  name: "Manhua Plus",
  baseUrl: "https://manhuaplus.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  filterNonMangaItems: false,
  pageListSelector: ".read-container img",
});
