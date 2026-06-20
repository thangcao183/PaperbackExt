import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "ManhwaHub",
  description: "ManhwaHub - ManhwaZ source (manhwahub.net). Converted from keiyoushi.",
  version: "1.4.5.1",
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
    { label: "ManhwaZ", textColor: "#FFFFFF", backgroundColor: "#6D4C41" },
    { label: "Mature", textColor: "#FFFFFF", backgroundColor: "#C62828" },
  ],
  developers: [
    {
      name: "Converted from keiyoushi",
    },
  ],
} satisfies ExtensionInfo;
