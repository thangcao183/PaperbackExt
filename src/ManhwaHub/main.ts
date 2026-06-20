import { ContentRating } from "@paperback/types";
import { ManhwaZExtension } from "../utils/manhwaz/template";

export const ManhwaHub = new ManhwaZExtension({
  name: "ManhwaHub",
  baseUrl: "https://manhwahub.net",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
