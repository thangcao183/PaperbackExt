import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const BattleIn5SecondsAfterMeeting = new MadaraExtension({
  name: "Battle In 5 Seconds After Meeting",
  baseUrl: "https://www.deatte5.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
