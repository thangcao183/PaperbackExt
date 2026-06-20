import { ContentRating } from "@paperback/types";
import { BakkinExtension } from "../utils/bakkin/template";

export const Bakkin = new BakkinExtension({
  name: "Bakkin",
  baseUrl: "https://bakkin.moe/reader",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
