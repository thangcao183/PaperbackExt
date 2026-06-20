import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const source = new MadaraExtension({
  name: "MangaOwl.io (unoriginal)",
  baseUrl: "https://mangaowl.io",
  mangaSubString: "read-1",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
