import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const Ryumanga = new KeyoappExtension({
  name: "Ryumanga",
  baseUrl: "https://ryumanga.org",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
