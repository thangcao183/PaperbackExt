import { ContentRating } from "@paperback/types";
import { EZManhwaExtension } from "../utils/ezmanhwa/template";

export const QiScans = new EZManhwaExtension({
  name: "Qi Scans",
  baseUrl: "https://qimanga.com",
  apiUrl: "https://api.qimanga.com/api/v1",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
