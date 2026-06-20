import { ContentRating } from "@paperback/types";
import { EZManhwaExtension } from "../utils/ezmanhwa/template";

export const EZmanga = new EZManhwaExtension({
  name: "EZmanga",
  baseUrl: "https://ezmanga.org",
  apiUrl: "https://vapi.ezmanga.org/api/v1",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
