import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";
export const LunaToons = new KeyoappExtension({
    name: "Luna Toons",
    baseUrl: "https://lunatoons.org",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
