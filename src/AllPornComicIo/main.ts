import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const AllPornComicIo = new MadaraExtension({
  name: "AllPornComic.io",
  baseUrl: "https://allporncomic.io",
  mangaSubString: "manga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
