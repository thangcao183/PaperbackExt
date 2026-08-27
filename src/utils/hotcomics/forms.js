import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export class HotComicsSearchForm extends AdvancedSearchForm {
    browseOptions;
    browse;
    constructor(browseOptions, initialMeta) {
        super();
        this.browseOptions = browseOptions;
        this.browse = initialMeta?.browse ?? [];
    }
    async updateBrowse(value) {
        this.browse = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                browse: this.browse,
            },
        };
    }
    getSections() {
        return [
            Section({
                id: "browse_filters",
                footer: "Browse category is ignored when a text search is entered.",
            }, [
                SelectRow("browse", {
                    title: "Browse",
                    value: this.browse,
                    options: this.browseOptions,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateBrowse"),
                }),
            ]),
        ];
    }
}
