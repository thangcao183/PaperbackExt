import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaDistrict = new MadaraExtension({
  name: "Manga District",
  baseUrl: "https://mangadistrict.com",
  mangaSubString: "series",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  pageListSelector: "div.page-break img:not(#image-99999)",
});
