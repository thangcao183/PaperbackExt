import { Form, Section, ToggleRow } from "@paperback/types";
const HIDE_PREMIUM_KEY = "asurascans.hidePremium";
export function getHidePremium() {
    const value = Application.getState(HIDE_PREMIUM_KEY);
    return typeof value === "boolean" ? value : true;
}
function setHidePremium(value) {
    Application.setState(value, HIDE_PREMIUM_KEY);
}
export class AsuraScansSettingsForm extends Form {
    hidePremium;
    constructor() {
        super();
        this.hidePremium = getHidePremium();
    }
    async updateHidePremium(value) {
        this.hidePremium = value;
        setHidePremium(value);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({ id: "chapters", footer: "Hide locked premium chapters from the list." }, [
                ToggleRow("hide_premium_chapters", {
                    title: "Hide premium chapters",
                    value: this.hidePremium,
                    onValueChange: Application.Selector(this, "updateHidePremium"),
                }),
            ]),
        ];
    }
}
