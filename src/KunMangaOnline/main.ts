import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const KunMangaOnline = new MadaraExtension({
  name: "Kun Manga Online",
  baseUrl: "https://www.kunmanga.online",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
