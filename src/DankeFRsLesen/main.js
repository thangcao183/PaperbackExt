import { ContentRating } from "@paperback/types";
import { GuyaExtension } from "../utils/guya/template";
export const DankeFRsLesen = new GuyaExtension({
    name: "Danke fürs Lesen",
    baseUrl: "https://danke.moe",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
