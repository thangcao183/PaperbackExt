import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Lua Scans",
  description: "Lua Scans - HeanCms source (luacomic.org). Converted from keiyoushi.",
  version: "1.4.52.1",
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
    { label: "HeanCms", textColor: "#FFFFFF", backgroundColor: "#0277BD" },
  ],
  developers: [
    { name: "nicartjay" },
    { name: "keiyoushi" },
  ],
} satisfies ExtensionInfo;
