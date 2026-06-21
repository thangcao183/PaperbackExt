import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaKiss = new MadaraExtension({
  name: "Manga Kiss",
  baseUrl: "https://mangakiss.org",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
