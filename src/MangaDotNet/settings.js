import { ButtonRow, Form, Section, ToggleRow } from '@paperback/types';
const SHOW_ADULT_KEY = 'mangadotnet.showAdult';
const SHOW_TAGS_KEY = 'mangadotnet.showTags';
export function getShowAdult() {
    const value = Application.getState(SHOW_ADULT_KEY);
    return typeof value === 'boolean' ? value : false;
}
function setShowAdult(value) {
    Application.setState(value, SHOW_ADULT_KEY);
}
export function getShowTags() {
    const value = Application.getState(SHOW_TAGS_KEY);
    return typeof value === 'boolean' ? value : true;
}
function setShowTags(value) {
    Application.setState(value, SHOW_TAGS_KEY);
}
export class MangaDotNetSettingsForm extends Form {
    showAdult = getShowAdult();
    showTags = getShowTags();
    async updateShowAdult(value) {
        this.showAdult = value;
        setShowAdult(value);
        this.reloadForm();
    }
    async updateShowTags(value) {
        this.showTags = value;
        setShowTags(value);
        this.reloadForm();
    }
    async resetSettings() {
        this.showAdult = false;
        setShowAdult(false);
        this.showTags = true;
        setShowTags(true);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({ id: 'content', footer: 'Show 18+ (NSFW) titles in browse and search.' }, [
                ToggleRow('show_adult', {
                    title: 'Show 18+ Content',
                    value: this.showAdult,
                    onValueChange: Application.Selector(this, 'updateShowAdult'),
                }),
                ToggleRow('show_tags', {
                    title: 'Show Tags In Details',
                    value: this.showTags,
                    onValueChange: Application.Selector(this, 'updateShowTags'),
                }),
                ButtonRow('reset', {
                    title: 'Reset to default',
                    onSelect: Application.Selector(this, 'resetSettings'),
                }),
            ]),
        ];
    }
}
