import { ContentRating, SourceIntents } from "@paperback/types";

export default {
  name: "Dilib",
  description: "Dilib.vn manga source",
  version: "0.1.0",
  icon: "icon.png",
  language: "vi",
  contentRating: ContentRating.EVERYONE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],
  badges: [{ label: "Vietnamese", textColor: "#FFFFFF", backgroundColor: "#1976D2" }],
  developers: [{ name: "thangcao183" }],
};
