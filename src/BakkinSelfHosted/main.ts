import { ContentRating } from "@paperback/types";
import { BakkinExtension } from "../utils/bakkin/template";

export const BakkinSelfHosted = new BakkinExtension({
  name: "Bakkin Self-hosted",
  baseUrl: "http://127.0.0.1",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
