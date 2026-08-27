import { ContentRating } from "@paperback/types";
import { MangaKExtension } from "../utils/mangak/template";
export const ToonilyMe = new MangaKExtension({
    name: "Toonily.me",
    baseUrl: "https://toontop.io",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
