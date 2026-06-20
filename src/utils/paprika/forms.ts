import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface PaprikaSearchMeta extends JSONObject {
  orderBy: string[];
}

export const ORDER_BY_OPTIONS: { id: string; title: string }[] = [
  { id: "2", title: "Views" },
  { id: "3", title: "Latest" },
  { id: "1", title: "A-Z" },
];

export class PaprikaSearchForm extends AdvancedSearchForm {
  private orderBy: string[];

  constructor(initialMeta?: PaprikaSearchMeta) {
    super();
    this.orderBy = initialMeta?.orderBy ?? [];
  }

  async updateOrderBy(value: string[]): Promise<void> {
    this.orderBy = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): PaprikaSearchMeta {
    return {
      orderBy: this.orderBy,
    } satisfies PaprikaSearchMeta;
  }

  override getSections() {
    return [
      Section("select_filters", [
        SelectRow("order_by", {
          title: "Order by",
          value: this.orderBy,
          options: ORDER_BY_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            PaprikaSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderBy"),
        }),
      ]),
    ];
  }
}
