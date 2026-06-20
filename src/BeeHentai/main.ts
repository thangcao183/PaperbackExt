import { ContentRating } from "@paperback/types";
import { MadThemeExtension } from "../utils/madtheme/template";

export const BeeHentai = new MadThemeExtension({
  name: "BeeHentai",
  baseUrl: "https://beehentai.com",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
