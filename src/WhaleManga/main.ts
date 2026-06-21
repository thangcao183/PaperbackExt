import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const WhaleManga = new MadaraExtension({
  name: "Whale Manga",
  baseUrl: "https://whalemanga.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
