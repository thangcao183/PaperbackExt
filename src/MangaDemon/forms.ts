import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaDemonSearchMeta extends JSONObject {
  sort: string[];
  status: string[];
  genres: string[];
}

// keiyoushi SortFilter
export const SORT_OPTIONS = [
  { id: "VIEWS DESC", title: "Top Views" },
  { id: "NAME ASC", title: "A To Z" },
];

// keiyoushi StatusFilter
export const STATUS_OPTIONS = [
  { id: "all", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

// keiyoushi GenreFilter (id = numeric value used in genre[] query param)
export const GENRE_OPTIONS = [
  { id: "1", title: "Action" },
  { id: "2", title: "Adventure" },
  { id: "3", title: "Comedy" },
  { id: "34", title: "Cooking" },
  { id: "25", title: "Doujinshi" },
  { id: "4", title: "Drama" },
  { id: "19", title: "Ecchi" },
  { id: "5", title: "Fantasy" },
  { id: "30", title: "Gender Bender" },
  { id: "10", title: "Harem" },
  { id: "28", title: "Historical" },
  { id: "8", title: "Horror" },
  { id: "33", title: "Isekai" },
  { id: "31", title: "Josei" },
  { id: "6", title: "Martial Arts" },
  { id: "22", title: "Mature" },
  { id: "32", title: "Mecha" },
  { id: "15", title: "Mystery" },
  { id: "26", title: "One Shot" },
  { id: "11", title: "Psychological" },
  { id: "12", title: "Romance" },
  { id: "13", title: "School Life" },
  { id: "16", title: "Sci-fi" },
  { id: "17", title: "Seinen" },
  { id: "14", title: "Shoujo" },
  { id: "23", title: "Shoujo Ai" },
  { id: "7", title: "Shounen" },
  { id: "29", title: "Shounen Ai" },
  { id: "21", title: "Slice of Life" },
  { id: "27", title: "Smut" },
  { id: "20", title: "Sports" },
  { id: "9", title: "Supernatural" },
  { id: "18", title: "Tragedy" },
  { id: "24", title: "Webtoons" },
];

export class MangaDemonSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private status: string[];
  private genres: string[];

  constructor(initialMeta?: MangaDemonSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.status = initialMeta?.status ?? [];
    this.genres = initialMeta?.genres ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateGenres(value: string[]): Promise<void> {
    this.genres = value;
    this.reloadForm();
  }

  override getSearchQueryMetadata(): MangaDemonSearchMeta {
    return {
      sort: this.sort,
      status: this.status,
      genres: this.genres,
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
            this as MangaDemonSearchForm,
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
            this as MangaDemonSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("genres", {
          title: "Genres",
          value: this.genres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangaDemonSearchForm,
            "updateGenres",
          ),
        }),
      ]),
    ];
  }
}
