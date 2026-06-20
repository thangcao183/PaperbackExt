import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";

export const KenScans = new IkenExtension({
  name: "Ken Scans",
  baseUrl: "https://kencomics.com",
  apiUrl: "https://api.kencomics.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
