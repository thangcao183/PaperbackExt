import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const RitharScans = new KeyoappExtension({
  name: "RitharScans",
  baseUrl: "https://ritharscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
