import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";

export const MangaPandaOnl = new MangaHubExtension({
  name: "MangaPanda.onl",
  baseUrl: "https://mangapanda.onl",
  mangaSource: "mr02",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
