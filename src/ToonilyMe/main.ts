import { ContentRating } from "@paperback/types";
import { MadThemeExtension } from "../utils/madtheme/template";

export const ToonilyMe = new MadThemeExtension({
  name: "Toonily.me",
  baseUrl: "https://toonily.me",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
