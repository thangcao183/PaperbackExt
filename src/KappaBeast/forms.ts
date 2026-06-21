import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface KappaBeastSearchMeta extends JSONObject {
  genre: string[];
  status: string[];
  type: string[];
  sort: string[];
}

const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Romance", title: "Romance" },
  { id: "Comedy", title: "Comedy" },
  { id: "Drama", title: "Drama" },
  { id: "Thriller", title: "Thriller" },
  { id: "Action", title: "Action" },
  { id: "Psychological", title: "Psychological" },
  { id: "Isekai", title: "Isekai" },
];

const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
];

const TYPE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
];

const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "Popularity" },
  { id: "updatedAt:desc", title: "Latest Updates" },
  { id: "createdAt:desc", title: "Newest" },
  { id: "title:asc", title: "A-Z Name" },
];

export class KappaBeastSearchForm extends AdvancedSearchForm {
  private genre: string[];
  private status: string[];
  private type: string[];
  private sort: string[];

  constructor(initialMeta?: KappaBeastSearchMeta) {
    super();
    this.genre = initialMeta?.genre ?? [];
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.sort = initialMeta?.sort ?? [];
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
    this.reloadForm();
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        genre: this.genre,
        status: this.status,
        type: this.type,
        sort: this.sort,
      } satisfies KappaBeastSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as KappaBeastSearchForm, "updateGenre"),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as KappaBeastSearchForm, "updateStatus"),
        }),
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as KappaBeastSearchForm, "updateType"),
        }),
        SelectRow("sort", {
          title: "Sort By",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as KappaBeastSearchForm, "updateSort"),
        }),
      ]),
    ];
  }
}
