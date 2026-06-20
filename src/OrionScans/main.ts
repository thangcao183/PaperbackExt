import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";

export const OrionScans = new IkenExtension({
  name: "Orion Scans",
  baseUrl: "https://orion-scans.com",
  apiUrl: "https://api.orion-scans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
