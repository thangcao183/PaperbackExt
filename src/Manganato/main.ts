import { ContentRating } from "@paperback/types";
import { MangaBoxExtension } from "../utils/mangabox/template";

export const Manganato = new MangaBoxExtension({
  name: "Manganato",
  baseUrl: "https://www.natomanga.com",
  mirrors: ["https://www.natomanga.com","https://www.nelomanga.com","https://www.nelomanga.net","https://www.manganato.gg"],
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
