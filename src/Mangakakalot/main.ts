import { ContentRating } from "@paperback/types";
import { MangaBoxExtension } from "../utils/mangabox/template";

export const Mangakakalot = new MangaBoxExtension({
  name: "Mangakakalot",
  baseUrl: "https://www.mangakakalot.gg",
  mirrors: ["https://www.mangakakalot.gg","https://www.mangakakalove.com"],
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
