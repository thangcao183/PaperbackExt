import { ContentRating } from "@paperback/types";
import { MangaReaderExtension } from "../utils/mangareader/template";
export const MangaNow = new MangaReaderExtension({
    name: "MangaNow",
    baseUrl: "https://manganow.to",
    pageListSelector: ".container-reader-chapter > .iv-card:not([data-url$=manganow.jpg])",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
