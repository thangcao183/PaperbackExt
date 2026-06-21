import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const HentaiRead = new MadaraExtension({
  name: "HentaiRead",
  baseUrl: "https://hentairead.com",
  mangaSubString: "hentai",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  popularMangaUrlSelector: "a.manga-item__link",
});
