import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const NyraScans = new KeyoappExtension({
  name: "Nyra Scans",
  baseUrl: "https://nyrascans.com",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
