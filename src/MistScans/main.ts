import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const MistScans = new KeyoappExtension({
  name: "Mist Scans",
  baseUrl: "https://mistscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
