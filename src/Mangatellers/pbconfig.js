import { ContentRating, SourceIntents } from "@paperback/types";
export default {
    name: "Mangatellers",
    description: "Mangatellers - FoolSlide source (reader.mangatellers.gr). Converted from keiyoushi.",
    version: "1.4.6.1",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.DISCOVER_SECTION_PROVIDING,
        SourceIntents.SEARCH_RESULT_PROVIDING,
        SourceIntents.CHAPTER_PROVIDING,
        SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
        SourceIntents.SETTINGS_FORM_PROVIDING,
    ],
    badges: [
        { label: "FoolSlide", textColor: "#FFFFFF", backgroundColor: "#5C6BC0" },
    ],
    developers: [
        { name: "nicartjay" },
        { name: "keiyoushi" },
    ],
};
