import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const ErisScans = new KeyoappExtension({
  name: "Eris Scans",
  baseUrl: "https://erisscans.com",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
