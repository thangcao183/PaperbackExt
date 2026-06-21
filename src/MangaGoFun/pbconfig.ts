import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "MangaGo.fun",
  description: "MangaGo.fun - Madara source (www.mangago.fun). Converted from keiyoushi.",
  version: "1.4.51.2",
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
    { label: "Madara", textColor: "#FFFFFF", backgroundColor: "#2E7D32" },
  ],
  developers: [
    {
      name: "Converted from keiyoushi",
    },
  ],
} satisfies ExtensionInfo;
