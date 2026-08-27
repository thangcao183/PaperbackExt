import { AdvancedSearchForm, Section, SelectRow } from '@paperback/types';
export const SORT_OPTIONS = [
    { id: '', title: 'Relevance' },
    { id: 'latest', title: 'Latest Update' },
    { id: 'alphabetical', title: 'Alphabetical' },
    { id: 'chapters', title: 'Total Chapters' },
    { id: 'views', title: 'Most Viewed' },
    { id: 'tracked', title: 'Most Tracked' },
    { id: 'rating', title: 'Top Rated' },
];
export const ORDER_OPTIONS = [
    { id: 'desc', title: 'Descending' },
    { id: 'asc', title: 'Ascending' },
];
export const STATUS_OPTIONS = [
    { id: '', title: 'Any Status' },
    { id: 'Ongoing', title: 'Ongoing' },
    { id: 'Completed', title: 'Completed' },
    { id: 'Hiatus', title: 'Hiatus' },
];
export const SCANLATOR_OPTIONS = [
    { id: '', title: 'Any' },
    { id: 'with', title: 'Scanlator Group' },
    { id: 'without', title: 'No Scanlator Group' },
];
export const TYPE_OPTIONS = [
    { id: 'JP', title: 'Manga' },
    { id: 'KR', title: 'Manhwa' },
    { id: 'CN', title: 'Manhua' },
    { id: 'ONESHOT', title: 'One Shot' },
];
export const DEMOGRAPHIC_OPTIONS = [
    { id: 'Josei', title: 'Josei' },
    { id: 'Seinen', title: 'Seinen' },
    { id: 'Shoujo', title: 'Shoujo' },
    { id: 'Shounen', title: 'Shounen' },
];
export class MangaDotNetSearchForm extends AdvancedSearchForm {
    sort;
    order;
    status;
    scanlator;
    types;
    demographics;
    constructor(initialMeta) {
        super();
        this.sort = initialMeta?.sort ?? [];
        this.order = initialMeta?.order ?? [];
        this.status = initialMeta?.status ?? [];
        this.scanlator = initialMeta?.scanlator ?? [];
        this.types = initialMeta?.types ?? [];
        this.demographics = initialMeta?.demographics ?? [];
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateOrder(value) {
        this.order = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateScanlator(value) {
        this.scanlator = value;
        this.reloadForm();
    }
    async updateTypes(value) {
        this.types = value;
        this.reloadForm();
    }
    async updateDemographics(value) {
        this.demographics = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                sort: this.sort,
                order: this.order,
                status: this.status,
                scanlator: this.scanlator,
                types: this.types,
                demographics: this.demographics,
            },
        };
    }
    getSections() {
        return [
            Section('filters', [
                SelectRow('sort', {
                    title: 'Sort',
                    value: this.sort,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, 'updateSort'),
                }),
                SelectRow('order', {
                    title: 'Order',
                    value: this.order,
                    options: ORDER_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, 'updateOrder'),
                }),
                SelectRow('status', {
                    title: 'Status',
                    value: this.status,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, 'updateStatus'),
                }),
                SelectRow('scanlator', {
                    title: 'Scanlator Group',
                    value: this.scanlator,
                    options: SCANLATOR_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, 'updateScanlator'),
                }),
                SelectRow('types', {
                    title: 'Types',
                    value: this.types,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: TYPE_OPTIONS.length,
                    onValueChange: Application.Selector(this, 'updateTypes'),
                }),
                SelectRow('demographics', {
                    title: 'Demographics',
                    value: this.demographics,
                    options: DEMOGRAPHIC_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: DEMOGRAPHIC_OPTIONS.length,
                    onValueChange: Application.Selector(this, 'updateDemographics'),
                }),
            ]),
        ];
    }
}
