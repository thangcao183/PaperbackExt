import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";

export const MangaReaderSite = new MangaHubExtension({
  name: "MangaReader.site",
  baseUrl: "https://mangareader.site",
  mangaSource: "mr01",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
