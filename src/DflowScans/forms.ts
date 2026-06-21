import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface DflowScansSearchMeta extends JSONObject {
  status: string[];
}

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
];

export class DflowScansSearchForm extends AdvancedSearchForm {
  private status: string[];

  constructor(initialMeta?: DflowScansSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        status: this.status,
      } satisfies DflowScansSearchMeta,
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
            this as DflowScansSearchForm,
            "updateStatus",
          ),
        }),
      ]),
    ];
  }
}
