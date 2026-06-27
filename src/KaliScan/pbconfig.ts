import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "KaliScan",
  description: "KaliScan - MadTheme source (kaliscan.com). Converted from keiyoushi.",
  version: "1.4.25.3",
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
    { label: "MadTheme", textColor: "#FFFFFF", backgroundColor: "#AD1457" },
    { label: "Mature", textColor: "#FFFFFF", backgroundColor: "#C62828" },
  ],
  developers: [
    { name: "nicartjay" },
    { name: "keiyoushi" },
  ],
} satisfies ExtensionInfo;
