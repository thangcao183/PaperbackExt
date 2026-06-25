import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "MurimScan",
  description: "MurimScan - ZeistManga source (www.murimscans.site). Converted from keiyoushi.",
  version: "1.4.49.1",
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
    { label: "ZeistManga", textColor: "#FFFFFF", backgroundColor: "#37474F" },
    { label: "Mature", textColor: "#FFFFFF", backgroundColor: "#C62828" },
  ],
  developers: [
    { name: "nicartjay" },
    { name: "keiyoushi" },
  ],
} satisfies ExtensionInfo;
