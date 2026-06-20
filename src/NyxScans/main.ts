import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";

export const NyxScans = new IkenExtension({
  name: "Nyx Scans",
  baseUrl: "https://nyxscans.com",
  apiUrl: "https://api.nyxscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
