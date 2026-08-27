import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const Petrotechsociety = new MadaraExtension({
    name: "Petrotechsociety",
    baseUrl: "https://www.petrotechsociety.org",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
