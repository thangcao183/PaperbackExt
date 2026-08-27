import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";
export const ParadiseScans = new KeyoappExtension({
    name: "Paradise Scans",
    baseUrl: "https://paradisescans.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
