import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const KewnScans = new KeyoappExtension({
  name: "Kewn Scans",
  baseUrl: "https://kewnscans.org",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
