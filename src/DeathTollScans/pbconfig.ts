import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Death Toll Scans",
  description: "Death Toll Scans - FoolSlide source (reader.deathtollscans.net). Converted from keiyoushi.",
  version: "1.4.5.1",
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
    { label: "FoolSlide", textColor: "#FFFFFF", backgroundColor: "#5C6BC0" },
  ],
  developers: [
    {
      name: "Converted from keiyoushi",
    },
  ],
} satisfies ExtensionInfo;
