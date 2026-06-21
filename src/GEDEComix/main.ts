import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const GEDEComix = new MadaraExtension({
  name: "GEDE Comix",
  baseUrl: "https://gedecomix.com",
  mangaSubString: "porncomic",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  mangaDetailsThumbnailSelector: "${super.mangaDetailsSelectorThumbnail}:not([data-eio])",
});
