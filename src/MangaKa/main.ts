import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaKa = new MadaraExtension({
  name: "MangaKa",
  baseUrl: "https://mangaka.cc",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  useLoadMoreRequest: true,
});
