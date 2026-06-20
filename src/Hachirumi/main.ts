import { ContentRating } from "@paperback/types";
import { GuyaExtension } from "../utils/guya/template";

export const Hachirumi = new GuyaExtension({
  name: "Hachirumi",
  baseUrl: "https://hachirumi.com",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
