import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";
export const KaizenScan = new KeyoappExtension({
    name: "Kaizen Scan",
    baseUrl: "https://kaizenscan.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
