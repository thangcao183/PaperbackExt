import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "I'm An Evil God",
  description: "I'm An Evil God - MangaCatalog source (imanevilgod.com). Converted from keiyoushi.",
  version: "1.4.7.1",
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
    { label: "MangaCatalog", textColor: "#FFFFFF", backgroundColor: "#00838F" },
  ],
  developers: [
    { name: "nicartjay" },
    { name: "keiyoushi" },
  ],
} satisfies ExtensionInfo;
