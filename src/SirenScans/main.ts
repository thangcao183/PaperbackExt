import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const SirenScans = new KeyoappExtension({
  name: "Siren Scans",
  baseUrl: "https://sirenscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
