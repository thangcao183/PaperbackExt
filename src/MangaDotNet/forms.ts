import { AdvancedSearchForm, Section, SelectRow, type JSONObject } from '@paperback/types'

export interface MangaDotNetSearchMeta extends JSONObject {
    sort: string[]
    order: string[]
    status: string[]
    types: string[]
    demographics: string[]
}

export const SORT_OPTIONS = [
    { id: '', title: 'Relevance' },
    { id: 'latest', title: 'Latest Update' },
    { id: 'alphabetical', title: 'Alphabetical' },
    { id: 'chapters', title: 'Total Chapters' },
    { id: 'views', title: 'Most Viewed' },
    { id: 'tracked', title: 'Most Tracked' },
    { id: 'rating', title: 'Top Rated' },
]

export const ORDER_OPTIONS = [
    { id: 'desc', title: 'Descending' },
    { id: 'asc', title: 'Ascending' },
]

export const STATUS_OPTIONS = [
    { id: '', title: 'Any Status' },
    { id: 'Ongoing', title: 'Ongoing' },
    { id: 'Completed', title: 'Completed' },
    { id: 'Hiatus', title: 'Hiatus' },
]

export const TYPE_OPTIONS = [
    { id: 'JP', title: 'Manga' },
    { id: 'KR', title: 'Manhwa' },
    { id: 'CN', title: 'Manhua' },
    { id: 'ONESHOT', title: 'One Shot' },
]

export const DEMOGRAPHIC_OPTIONS = [
    { id: 'Josei', title: 'Josei' },
    { id: 'Seinen', title: 'Seinen' },
    { id: 'Shoujo', title: 'Shoujo' },
    { id: 'Shounen', title: 'Shounen' },
]

export class MangaDotNetSearchForm extends AdvancedSearchForm {
    private sort: string[]
    private order: string[]
    private status: string[]
    private types: string[]
    private demographics: string[]

    constructor(initialMeta?: MangaDotNetSearchMeta) {
        super()
        this.sort = initialMeta?.sort ?? []
        this.order = initialMeta?.order ?? []
        this.status = initialMeta?.status ?? []
        this.types = initialMeta?.types ?? []
        this.demographics = initialMeta?.demographics ?? []
    }

    async updateSort(value: string[]): Promise<void> {
        this.sort = value
        this.reloadForm()
    }

    async updateOrder(value: string[]): Promise<void> {
        this.order = value
        this.reloadForm()
    }

    async updateStatus(value: string[]): Promise<void> {
        this.status = value
        this.reloadForm()
    }

    async updateTypes(value: string[]): Promise<void> {
        this.types = value
        this.reloadForm()
    }

    async updateDemographics(value: string[]): Promise<void> {
        this.demographics = value
        this.reloadForm()
    }

    getSearchQueryMetadata(): JSONObject {
        return {
            searchMeta: {
                sort: this.sort,
                order: this.order,
                status: this.status,
                types: this.types,
                demographics: this.demographics,
            } satisfies MangaDotNetSearchMeta,
        }
    }

    override getSections() {
        return [
            Section('filters', [
                SelectRow('sort', {
                    title: 'Sort',
                    value: this.sort,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this as MangaDotNetSearchForm, 'updateSort'),
                }),
                SelectRow('order', {
                    title: 'Order',
                    value: this.order,
                    options: ORDER_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this as MangaDotNetSearchForm, 'updateOrder'),
                }),
                SelectRow('status', {
                    title: 'Status',
                    value: this.status,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this as MangaDotNetSearchForm, 'updateStatus'),
                }),
                SelectRow('types', {
                    title: 'Types',
                    value: this.types,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: TYPE_OPTIONS.length,
                    onValueChange: Application.Selector(this as MangaDotNetSearchForm, 'updateTypes'),
                }),
                SelectRow('demographics', {
                    title: 'Demographics',
                    value: this.demographics,
                    options: DEMOGRAPHIC_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: DEMOGRAPHIC_OPTIONS.length,
                    onValueChange: Application.Selector(
                        this as MangaDotNetSearchForm,
                        'updateDemographics',
                    ),
                }),
            ]),
        ]
    }
}
