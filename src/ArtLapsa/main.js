import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";
export const ArtLapsa = new KeyoappExtension({
    name: "Art Lapsa",
    baseUrl: "https://artlapsa.com",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
