import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Manhwajoy = new MadaraExtension({
  name: "Manhwajoy",
  baseUrl: "https://manhwajoy.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
