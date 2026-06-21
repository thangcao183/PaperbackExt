import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface NewManhwaSearchMeta extends JSONObject {
  status: string[];
  genre: string[];
  sort: string[];
}

const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
];

const GENRE_OPTIONS = [
  { id: "", title: "All" },
  { id: "Action", title: "Action" },
  { id: "Drama", title: "Drama" },
  { id: "Ecchi", title: "Ecchi" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Harem", title: "Harem" },
  { id: "Historical", title: "Historical" },
  { id: "Martial Arts", title: "Martial Arts" },
  { id: "Mature", title: "Mature" },
  { id: "Mystery", title: "Mystery" },
  { id: "Psychological", title: "Psychological" },
  { id: "Romance", title: "Romance" },
  { id: "School Life", title: "School Life" },
];

const SORT_OPTIONS = [
  { id: "updated", title: "Updated" },
  { id: "popular", title: "Popular" },
  { id: "chapters", title: "Most Chapters" },
  { id: "newest", title: "Newest" },
  { id: "az", title: "A-Z" },
  { id: "za", title: "Z-A" },
];

export class NewManhwaSearchForm extends AdvancedSearchForm {
  private status: string[];
  private genre: string[];
  private sort: string[];

  constructor(initialMeta?: NewManhwaSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.genre = initialMeta?.genre ?? [];
    this.sort = initialMeta?.sort ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        status: this.status,
        genre: this.genre,
        sort: this.sort,
      } satisfies NewManhwaSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NewManhwaSearchForm,
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
            this as NewManhwaSearchForm,
            "updateGenre",
          ),
        }),
        SelectRow("sort", {
          title: "Sort by",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NewManhwaSearchForm,
            "updateSort",
          ),
        }),
      ]),
    ];
  }
}
