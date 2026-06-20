import { ContentRating } from "@paperback/types";
import { EroMuseExtension } from "../utils/eromuse/template";

export const Erofus = new EroMuseExtension({
  name: "Erofus",
  baseUrl: "https://www.erofus.com",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
