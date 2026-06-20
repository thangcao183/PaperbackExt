import { ContentRating } from "@paperback/types";
import { PaprikaExtension } from "../utils/paprika/template";

export const MangaReaderIn = new PaprikaExtension({
  name: "MangaReader.in",
  baseUrl: "https://mangareader.in",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
