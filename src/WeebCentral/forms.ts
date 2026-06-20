import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface WeebCentralSearchMeta extends JSONObject {
  sort: string[];
  order: string[];
  adult: string[];
  status: string[];
  type: string[];
  tags: string[];
  author: string;
}

export const SORT_OPTIONS = [
  { id: "Best Match", title: "Best Match" },
  { id: "Alphabet", title: "Alphabet" },
  { id: "Popularity", title: "Popularity" },
  { id: "Subscribers", title: "Subscribers" },
  { id: "Recently Added", title: "Recently Added" },
  { id: "Latest Updates", title: "Latest Updates" },
];

export const ORDER_OPTIONS = [
  { id: "Descending", title: "Descending" },
  { id: "Ascending", title: "Ascending" },
];

export const ADULT_OPTIONS = [
  { id: "Any", title: "Any" },
  { id: "True", title: "Include" },
  { id: "False", title: "Exclude" },
];

export const STATUS_OPTIONS = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Complete", title: "Complete" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Canceled", title: "Canceled" },
];

export const TYPE_OPTIONS = [
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "OEL", title: "OEL" },
];

export const TAG_OPTIONS = [
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gender Bender",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Lolicon",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-fi",
  "Seinen",
  "Shotacon",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Yaoi",
  "Yuri",
  "Other",
].map((t) => ({ id: t, title: t }));

export class WeebCentralSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private order: string[];
  private adult: string[];
  private status: string[];
  private type: string[];
  private tags: string[];
  private author: string;

  constructor(initialMeta?: WeebCentralSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.order = initialMeta?.order ?? [];
    this.adult = initialMeta?.adult ?? [];
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.tags = initialMeta?.tags ?? [];
    this.author = initialMeta?.author ?? "";
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateOrder(value: string[]): Promise<void> {
    this.order = value;
    this.reloadForm();
  }

  async updateAdult(value: string[]): Promise<void> {
    this.adult = value;
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

  async updateTags(value: string[]): Promise<void> {
    this.tags = value;
    this.reloadForm();
  }

  async updateAuthor(value: string): Promise<void> {
    this.author = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): { searchMeta: WeebCentralSearchMeta } {
    return {
      searchMeta: {
        sort: this.sort,
        order: this.order,
        adult: this.adult,
        status: this.status,
        type: this.type,
        tags: this.tags,
        author: this.author,
      } satisfies WeebCentralSearchMeta,
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
            this as WeebCentralSearchForm,
            "updateSort",
          ),
        }),
        SelectRow("order", {
          title: "Sort Order",
          value: this.order,
          options: ORDER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as WeebCentralSearchForm,
            "updateOrder",
          ),
        }),
        SelectRow("adult", {
          title: "Adult Content",
          value: this.adult,
          options: ADULT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as WeebCentralSearchForm,
            "updateAdult",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: STATUS_OPTIONS.length,
          onValueChange: Application.Selector(
            this as WeebCentralSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: TYPE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as WeebCentralSearchForm,
            "updateType",
          ),
        }),
        SelectRow("tags", {
          title: "Tags",
          value: this.tags,
          options: TAG_OPTIONS,
          minItemCount: 0,
          maxItemCount: TAG_OPTIONS.length,
          onValueChange: Application.Selector(
            this as WeebCentralSearchForm,
            "updateTags",
          ),
        }),
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as WeebCentralSearchForm,
            "updateAuthor",
          ),
        }),
      ]),
    ];
  }
}
