import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface HeyToonSearchMeta extends JSONObject {
  sort: string[];
  genre: string[];
}

const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "latest", title: "Most Recent" },
  { id: "views", title: "Most Viewed" },
];

const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Detective", title: "Detective" },
  { id: "Spin-Off", title: "Spin-Off" },
  { id: "Mommy", title: "Mommy" },
  { id: "Uncensored", title: "Uncensored" },
  { id: "New", title: "New" },
  { id: "In-Law", title: "In-Law" },
  { id: "Cheating", title: "Cheating" },
  { id: "MILF", title: "MILF" },
  { id: "Harem", title: "Harem" },
  { id: "College", title: "College" },
  { id: "Business", title: "Business" },
  { id: "Supernatural", title: "Supernatural" },
  { id: "Thriller", title: "Thriller" },
  { id: "Adventure", title: "Adventure" },
  { id: "Romance", title: "Romance" },
  { id: "Drama", title: "Drama" },
];

export class HeyToonSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private genre: string[];

  constructor(initialMeta?: HeyToonSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.genre = initialMeta?.genre ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        sort: this.sort,
        genre: this.genre,
      } satisfies HeyToonSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("sort", {
          title: "Sort",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as HeyToonSearchForm,
            "updateSort",
          ),
        }),
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as HeyToonSearchForm,
            "updateGenre",
          ),
        }),
      ]),
    ];
  }
}
