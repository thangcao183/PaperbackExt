import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "ReadComicOnline",
  description:
    "ReadComicOnline - custom source (readcomiconline.li). Converted from keiyoushi.",
  version: "1.4.43.12",
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
  badges: [],
  developers: [{ name: "nicartjay" }, { name: "keiyoushi" }],
} satisfies ExtensionInfo;
