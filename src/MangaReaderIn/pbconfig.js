import { ContentRating, SourceIntents } from "@paperback/types";
export default {
    name: "MangaReader.in",
    description: "MangaReader.in - Paprika source (mangareader.in). Converted from keiyoushi.",
    version: "1.4.6.1",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.MATURE,
    capabilities: [
        SourceIntents.DISCOVER_SECTION_PROVIDING,
        SourceIntents.SEARCH_RESULT_PROVIDING,
        SourceIntents.CHAPTER_PROVIDING,
        SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
        SourceIntents.SETTINGS_FORM_PROVIDING,
    ],
    badges: [
        { label: "Paprika", textColor: "#FFFFFF", backgroundColor: "#E65100" },
        { label: "Mature", textColor: "#FFFFFF", backgroundColor: "#C62828" },
    ],
    developers: [
        { name: "nicartjay" },
        { name: "keiyoushi" },
    ],
};
