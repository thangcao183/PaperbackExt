import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaBttSearchMeta extends JSONObject {
  sort: string[];
  status: string[];
  genre: string[];
}

export const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "13", title: "Top day" },
  { id: "12", title: "Top week" },
  { id: "11", title: "Top month" },
  { id: "10", title: "Top All" },
  { id: "25", title: "Comment" },
  { id: "15", title: "New Manga" },
  { id: "30", title: "Chapter" },
  { id: "0", title: "Latest Updates" },
];

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "-1", title: "All" },
  { id: "2", title: "Completed" },
  { id: "1", title: "Ongoing" },
];

export const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "drama", title: "Drama" },
  { id: "fantasy", title: "Fantasy" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "josei", title: "Josei" },
  { id: "manhua", title: "Manhua" },
  { id: "manhwa", title: "Manhwa" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mecha", title: "Mecha" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shounen", title: "Shounen" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "sports", title: "Sports" },
  { id: "suggestive", title: "Suggestive" },
  { id: "supernatural", title: "Supernatural" },
  { id: "tragedy", title: "Tragedy" },
  { id: "webtoons", title: "Webtoons" },
];

export class MangaBttSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private status: string[];
  private genre: string[];

  constructor(initialMeta?: MangaBttSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.status = initialMeta?.status ?? [];
    this.genre = initialMeta?.genre ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
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
        status: this.status,
        genre: this.genre,
      } satisfies MangaBttSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("sort", {
          title: "Sort By",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaBttSearchForm,
            "updateSort",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaBttSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaBttSearchForm,
            "updateGenre",
          ),
        }),
      ]),
    ];
  }
}
