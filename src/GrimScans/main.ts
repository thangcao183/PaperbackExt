import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const GrimScans = new KeyoappExtension({
  name: "Grim Scans",
  baseUrl: "https://grimscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
