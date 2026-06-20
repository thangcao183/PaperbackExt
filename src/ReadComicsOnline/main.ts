import { ContentRating } from "@paperback/types";
import { MMRCMSExtension } from "../utils/mmrcms/template";

export const ReadComicsOnline = new MMRCMSExtension({
  name: "Read Comics Online",
  baseUrl: "https://readcomicsonline.ru",
  itemPath: "comic",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
