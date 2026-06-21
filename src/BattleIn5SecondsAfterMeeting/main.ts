import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const BattleIn5SecondsAfterMeeting = new MadaraExtension({
  name: "Battle In 5 Seconds After Meeting",
  baseUrl: "https://www.deatte5.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  supportsLatest: false,
  mangaDetailsStatusSelector: "h5:contains(Status) + h4",
  mangaDetailsDescriptionSelector: ".synopsis p",
  mangaDetailsThumbnailSelector: ".cover_managa img",
  mangaDetailsTitleSelector: "h1",
  mangaDetailsAuthorSelector: "h5:contains(Author) + h4 a",
  mangaDetailsArtistSelector: "h5:contains(Artist) + h4 a",
});
