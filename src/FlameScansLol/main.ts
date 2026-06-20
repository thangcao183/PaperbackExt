import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const FlameScansLol = new MadaraExtension({
  name: "FlameScans.lol",
  baseUrl: "https://flamescans.lol",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
