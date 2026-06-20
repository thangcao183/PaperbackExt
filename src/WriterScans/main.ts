import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const WriterScans = new KeyoappExtension({
  name: "Writer Scans",
  baseUrl: "https://writerscans.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
