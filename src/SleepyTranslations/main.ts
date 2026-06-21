import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const SleepyTranslations = new MadaraExtension({
  name: "Sleepy Translations",
  baseUrl: "https://sleepytranslations.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
