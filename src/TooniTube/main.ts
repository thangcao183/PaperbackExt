import { ContentRating } from "@paperback/types";
import { MadThemeExtension } from "../utils/madtheme/template";

export const TooniTube = new MadThemeExtension({
  name: "TooniTube",
  baseUrl: "https://toonitube.com",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
