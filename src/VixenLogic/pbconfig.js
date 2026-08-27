import { ContentRating, SourceIntents } from "@paperback/types";
export default {
    name: "Vixen Logic",
    description: "Vixen Logic - webcomic source (www.vixenlogic.com). Converted from keiyoushi.",
    version: "1.4.1.1",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.ADULT,
    capabilities: [
        SourceIntents.DISCOVER_SECTION_PROVIDING,
        SourceIntents.SEARCH_RESULT_PROVIDING,
        SourceIntents.CHAPTER_PROVIDING,
        SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
    ],
    badges: [{ label: "Mature", textColor: "#FFFFFF", backgroundColor: "#C62828" }],
    developers: [{ name: "nicartjay" }, { name: "keiyoushi" }],
};
