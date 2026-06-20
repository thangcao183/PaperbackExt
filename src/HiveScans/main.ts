import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";

export const HiveScans = new IkenExtension({
  name: "Hive Scans",
  baseUrl: "https://hivetoons.org",
  apiUrl: "https://api.hivetoons.org",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
