import { Form, Section, SelectRow } from "@paperback/types";

const EXCLUDE_GENRES_KEY = "atsumaru.excludeGenres";

/**
 * Genres excluded from browsing. Mirrors the upstream `PREF_EXCLUDE_GENRES`
 * MultiSelectListPreference added in #18502: the ids are passed to the site as
 * `&excludedTags=` on the browse carousels and as a `genreIds:!=[...]`
 * Typesense filter on search.
 */
export function getExcludedGenres(): string[] {
  const value = Application.getState(EXCLUDE_GENRES_KEY);
  return Array.isArray(value) ? (value as string[]) : [];
}

function setExcludedGenres(value: string[]): void {
  Application.setState(value, EXCLUDE_GENRES_KEY);
}

export class AtsumaruSettingsForm extends Form {
  private excluded: string[];

  constructor(private readonly genres: { name: string; id: string }[]) {
    super();
    this.excluded = getExcludedGenres();
  }

  async updateExcluded(value: string[]): Promise<void> {
    this.excluded = value;
    setExcludedGenres(value);
    this.reloadForm();
  }

  override getSections() {
    return [
      Section(
        {
          id: "browse",
          footer:
            "Titles in the selected genres are hidden from the discover " +
            "carousels and from search results.",
        },
        [
          SelectRow("exclude_genres", {
            title: "Exclude genres from browse",
            value: this.excluded,
            options: this.genres.map((g) => ({ id: g.id, title: g.name })),
            minItemCount: 0,
            maxItemCount: this.genres.length,
            onValueChange: Application.Selector<
              AtsumaruSettingsForm,
              (value: string[]) => Promise<void>
            >(this, "updateExcluded"),
          }),
        ],
      ),
    ];
  }
}
