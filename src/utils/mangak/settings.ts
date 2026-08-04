import { Form, LabelRow, Section, SelectRow } from "@paperback/types";

const BLACKLIST_KEY_PREFIX = "mangak.blacklist.";
const GENRE_CACHE_KEY_PREFIX = "mangak.genreCache.";

export interface MangaKGenre {
  id: string;
  title: string;
}

function blacklistKey(sourceName: string): string {
  return `${BLACKLIST_KEY_PREFIX}${sourceName}`;
}

function genreCacheKey(sourceName: string): string {
  return `${GENRE_CACHE_KEY_PREFIX}${sourceName}`;
}

/**
 * Genre slugs the user always wants excluded from browse and search results.
 * Mirrors the upstream `pref_blacklist` MultiSelectListPreference.
 */
export function getBlacklist(sourceName: string): string[] {
  const value = Application.getState(blacklistKey(sourceName));
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function setBlacklist(sourceName: string, value: string[]): void {
  Application.setState(value, blacklistKey(sourceName));
}

/**
 * The genre list is fetched from `/genres` on demand. It is cached in state so
 * the settings form (which cannot perform requests while rendering) can offer
 * the blacklist options after the search filters have been opened once.
 */
export function getCachedGenres(sourceName: string): MangaKGenre[] {
  const value = Application.getState(genreCacheKey(sourceName));
  if (!Array.isArray(value)) return [];
  const genres: MangaKGenre[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, title } = entry as { id?: unknown; title?: unknown };
    if (typeof id === "string" && typeof title === "string" && id.length > 0) {
      genres.push({ id, title });
    }
  }
  return genres;
}

export function setCachedGenres(
  sourceName: string,
  genres: MangaKGenre[],
): void {
  Application.setState(
    genres.map((g) => ({ id: g.id, title: g.title })),
    genreCacheKey(sourceName),
  );
}

/**
 * Settings form for a MangaK source. Exposes the global genre blacklist.
 */
export class MangaKSettingsForm extends Form {
  private blacklist: string[];
  private genres: MangaKGenre[];

  constructor(private readonly sourceName: string) {
    super();
    this.blacklist = getBlacklist(sourceName);
    this.genres = getCachedGenres(sourceName);
  }

  async updateBlacklist(value: string[]): Promise<void> {
    this.blacklist = value;
    setBlacklist(this.sourceName, value);
    this.reloadForm();
  }

  override getSections() {
    if (this.genres.length === 0) {
      return [
        Section(
          {
            id: "blacklist",
            footer:
              "Open the search filters in the browse screen once to load and " +
              "sync the genre list, then return here.",
          },
          [
            LabelRow("blacklist_empty", {
              title: "Global Genre Blacklist",
              value: "No genres loaded yet",
            }),
          ],
        ),
      ];
    }

    return [
      Section(
        {
          id: "blacklist",
          footer:
            "Select genres to always exclude from search and browse results.",
        },
        [
          SelectRow("blacklist_select", {
            title: "Global Genre Blacklist",
            value: this.blacklist,
            options: this.genres,
            minItemCount: 0,
            maxItemCount: this.genres.length,
            onValueChange: Application.Selector<
              MangaKSettingsForm,
              (value: string[]) => Promise<void>
            >(this, "updateBlacklist"),
          }),
        ],
      ),
    ];
  }
}
