import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const NecroScans = new KeyoappExtension({
  name: "Necro Scans",
  baseUrl: "https://necroscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
