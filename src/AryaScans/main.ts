import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const AryaScans = new MadaraExtension({
  name: "Arya Scans",
  baseUrl: "https://brainrotcomics.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  popularMangaUrlSelector: "${super.popularMangaUrlSelector}:not([href=New]):not([target=_self])",
});
