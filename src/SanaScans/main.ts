import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";

export const SanaScans = new IkenExtension({
  name: "Sana Scans",
  baseUrl: "https://sanascans.com",
  apiUrl: "https://api.sanascans.com",
  perPage: 30,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
