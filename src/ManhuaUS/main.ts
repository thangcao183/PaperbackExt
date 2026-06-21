import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaUS = new MadaraExtension({
  name: "ManhuaUS",
  baseUrl: "https://manhuaus.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  filterNonMangaItems: false,
});
