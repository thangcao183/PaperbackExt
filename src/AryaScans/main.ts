import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const AryaScans = new MadaraExtension({
  name: "Arya Scans",
  baseUrl: "https://brainrotcomics.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
