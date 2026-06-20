import { ContentRating } from "@paperback/types";
import { ManhwaZExtension } from "../utils/manhwaz/template";

export const ManhwaZ = new ManhwaZExtension({
  name: "ManhwaZ",
  baseUrl: "https://manhwaz.com",
  popularGenrePath: "genre/manhwa",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
