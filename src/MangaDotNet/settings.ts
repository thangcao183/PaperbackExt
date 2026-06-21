import { ButtonRow, Form, Section, ToggleRow } from '@paperback/types'

const SHOW_ADULT_KEY = 'mangadotnet.showAdult'

export function getShowAdult(): boolean {
    const value = Application.getState(SHOW_ADULT_KEY)
    return typeof value === 'boolean' ? value : false
}

function setShowAdult(value: boolean): void {
    Application.setState(value, SHOW_ADULT_KEY)
}

export class MangaDotNetSettingsForm extends Form {
    private showAdult: boolean = getShowAdult()

    async updateShowAdult(value: boolean): Promise<void> {
        this.showAdult = value
        setShowAdult(value)
        this.reloadForm()
    }

    async resetSettings(): Promise<void> {
        this.showAdult = false
        setShowAdult(false)
        this.reloadForm()
    }

    override getSections() {
        return [
            Section({ id: 'content', footer: 'Show 18+ (NSFW) titles in browse and search.' }, [
                ToggleRow('show_adult', {
                    title: 'Show 18+ Content',
                    value: this.showAdult,
                    onValueChange: Application.Selector(
                        this as MangaDotNetSettingsForm,
                        'updateShowAdult',
                    ),
                }),
                ButtonRow('reset', {
                    title: 'Reset to default',
                    onSelect: Application.Selector(this as MangaDotNetSettingsForm, 'resetSettings'),
                }),
            ]),
        ]
    }
}
