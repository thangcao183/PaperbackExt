import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface HotComicsSearchMeta extends JSONObject {
  browse: string[];
}

export interface HotComicsBrowseOption {
  id: string;
  title: string;
}

export class HotComicsSearchForm extends AdvancedSearchForm {
  private browse: string[];

  constructor(
    private readonly browseOptions: HotComicsBrowseOption[],
    initialMeta?: HotComicsSearchMeta,
  ) {
    super();
    this.browse = initialMeta?.browse ?? [];
  }

  async updateBrowse(value: string[]): Promise<void> {
    this.browse = value;
    this.reloadForm();
  }

  getSearchQueryMetadata() {
    return {
      searchMeta: {
        browse: this.browse,
      } satisfies HotComicsSearchMeta,
    };
  }

  override getSections() {
    return [
      Section(
        {
          id: "browse_filters",
          footer: "Browse category is ignored when a text search is entered.",
        },
        [
          SelectRow("browse", {
            title: "Browse",
            value: this.browse,
            options: this.browseOptions,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector<
              HotComicsSearchForm,
              (value: string[]) => Promise<void>
            >(this, "updateBrowse"),
          }),
        ],
      ),
    ];
  }
}
