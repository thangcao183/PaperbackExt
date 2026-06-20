import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const MeiToon = new KeyoappExtension({
  name: "MeiToon",
  baseUrl: "https://meitoon.org",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
