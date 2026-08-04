import {
  Chapter,
  ContentRating,
  SourceManga,
} from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

// Upstream keiyoushi PR #18071: Asmodeus Scans replaced its opaque 11-character
// hex series slugs with title-derived slugs, which broke every entry already in
// a user's library. Upstream fixes this by rewriting the *request* URL (never
// the stored id) from the manga title. Paperback only hands us a title in
// `getChapters`, so we rewrite there and cache the mapping so that subsequent
// `getMangaDetails` calls for the same legacy id can be repaired too.
const LEGACY_SLUG_REGEX = /^[0-9a-f]{11}$/;
const SLUG_MAP_KEY = "asmodeus.legacySlugMap";

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readSlugMap(): Record<string, string> {
  const value = Application.getState(SLUG_MAP_KEY);
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // fall through to an empty map
    }
  }
  return {};
}

function rememberSlug(legacyId: string, slug: string): void {
  const map = readSlugMap();
  if (map[legacyId] === slug) return;
  map[legacyId] = slug;
  Application.setState(JSON.stringify(map), SLUG_MAP_KEY);
}

class AsmodeusScansExtension extends KeyoappExtension {
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const fixed = this.fixSourceManga(sourceManga);
    const chapters = await super.getChapters(fixed);
    // Keep the ids the app already knows about, only the request URL changed.
    return chapters.map((chapter) => ({ ...chapter, sourceManga }));
  }

  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const details = await super.getMangaDetails(this.resolveMangaId(mangaId));
    return { ...details, mangaId };
  }

  override getMangaShareUrl(mangaId: string): string {
    return super.getMangaShareUrl(this.resolveMangaId(mangaId));
  }

  private fixSourceManga(sourceManga: SourceManga): SourceManga {
    const mangaId = sourceManga.mangaId;
    if (!LEGACY_SLUG_REGEX.test(mangaId)) return sourceManga;

    const slug = titleToSlug(sourceManga.mangaInfo.primaryTitle);
    if (!slug) return sourceManga;

    rememberSlug(mangaId, slug);
    return { ...sourceManga, mangaId: slug };
  }

  // Returns the slug that should actually be requested for `mangaId`.
  private resolveMangaId(mangaId: string): string {
    if (!LEGACY_SLUG_REGEX.test(mangaId)) return mangaId;
    return readSlugMap()[mangaId] ?? mangaId;
  }
}

export const AsmodeusScans = new AsmodeusScansExtension({
  name: "Asmodeus Scans",
  baseUrl: "https://asmotoon.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
