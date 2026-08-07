import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface AlphaMangaSearchMeta extends JSONObject {
  status: string[];
  genre: string[];
}

// Upstream `StatusFilter` (Filters.kt) -> `progress` query parameter.
export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "2", title: "Ongoing" },
  { id: "1", title: "Completed" },
  { id: "3", title: "Suspended" },
];

// Upstream `GenreFilter` (Filters.kt) -> `genre` query parameter.
export const GENRE_OPTIONS = [
  { id: "", title: "All" },
  { id: "1001", title: "Shonen" },
  { id: "1002", title: "Shojo" },
  { id: "1033", title: "Romance" },
  { id: "1003", title: "Action" },
  { id: "1037", title: "Villainess" },
  { id: "1005", title: "Reincarnation" },
  { id: "1057", title: "Slice of Life" },
  { id: "1041", title: "Anime" },
];

export class AlphaMangaSearchForm extends AdvancedSearchForm {
  private status: string[];
  private genre: string[];

  constructor(initialMeta?: AlphaMangaSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.genre = initialMeta?.genre ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  getSearchQueryMetadata() {
    return {
      searchMeta: {
        status: this.status,
        genre: this.genre,
      } satisfies AlphaMangaSearchMeta,
    };
  }

  override getSections() {
    return [
      Section(
        {
          id: "select_filters",
          footer: "The search term and the filters below are applied together.",
        },
        [
          SelectRow("status", {
            title: "Progress",
            value: this.status,
            options: STATUS_OPTIONS,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector<
              AlphaMangaSearchForm,
              (value: string[]) => Promise<void>
            >(this, "updateStatus"),
          }),
          SelectRow("genre", {
            title: "Genres",
            value: this.genre,
            options: GENRE_OPTIONS,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector<
              AlphaMangaSearchForm,
              (value: string[]) => Promise<void>
            >(this, "updateGenre"),
          }),
        ],
      ),
    ];
  }
}
