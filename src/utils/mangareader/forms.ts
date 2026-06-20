import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaReaderSearchMeta extends JSONObject {
  sort: string[];
}

export const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "default", title: "Default" },
  { id: "latest-updated", title: "Latest Updated" },
  { id: "score", title: "Score" },
  { id: "name-az", title: "Name A-Z" },
  { id: "release-date", title: "Release Date" },
  { id: "most-viewed", title: "Most Viewed" },
];

export class MangaReaderSearchForm extends AdvancedSearchForm {
  private sort: string[];

  constructor(initialMeta?: MangaReaderSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): MangaReaderSearchMeta {
    return {
      sort: this.sort,
    } satisfies MangaReaderSearchMeta;
  }

  override getSections() {
    return [
      Section("select_filters", [
        SelectRow("sort", {
          title: "Sort",
          value: this.sort,
          options: SORT_OPTIONS.map((o) => ({ id: o.id, title: o.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaReaderSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateSort"),
        }),
      ]),
    ];
  }
}
