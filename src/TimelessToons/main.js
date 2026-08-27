import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";
export const TimelessToons = new KeyoappExtension({
    name: "TimelessToons",
    baseUrl: "https://timelesstoons.org",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
