import { ContentRating } from "@paperback/types";
import { FoolSlideExtension } from "../utils/foolslide/template";

export const Mangatellers = new FoolSlideExtension({
  name: "Mangatellers",
  baseUrl: "https://reader.mangatellers.gr",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
