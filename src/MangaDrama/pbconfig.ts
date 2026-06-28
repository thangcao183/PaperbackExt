import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Manga Drama",
  description:
    "Manga Drama - Madara source (mangadrama.com). Converted from keiyoushi.",
  version: "1.4.51.3",
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
    { label: "Madara", textColor: "#FFFFFF", backgroundColor: "#2E7D32" },
  ],
  developers: [
    { name: "nicartjay" },
    { name: "keiyoushi" },
  ],
} satisfies ExtensionInfo;
