import { ContentRating } from "@paperback/types";
import { GuyaExtension } from "../utils/guya/template";

export const Guya = new GuyaExtension({
  name: "Guya",
  baseUrl: "https://guya.cubari.moe",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
