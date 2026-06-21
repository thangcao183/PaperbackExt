import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const Hiperdex = new MadaraExtension({
  name: "Hiperdex",
  baseUrl: "https://hiperdex.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  chapterUrlSuffix: "",
  mangaDetailsStatusSelector: "div.summary-heading:contains(Status) + div.summary-content",
  pageListSelector: "div.page-break:not([style*='display:none'])",
});
