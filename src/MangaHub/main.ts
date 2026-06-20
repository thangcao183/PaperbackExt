import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";

export const MangaHub = new MangaHubExtension({
  name: "MangaHub",
  baseUrl: "https://mangahub.io",
  mangaSource: "m01",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
