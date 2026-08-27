import { ContentRating } from "@paperback/types";
import { EroMuseExtension } from "../utils/eromuse/template";
export const Src8Muses = new EroMuseExtension({
    name: "8Muses",
    baseUrl: "https://comics.8muses.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
