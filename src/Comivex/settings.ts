import { Form, Section, ToggleRow } from "@paperback/types";

const HIDE_STALE_KEY = "comivex.hideStale";

export function getHideStale(): boolean {
  const value = Application.getState(HIDE_STALE_KEY);
  return typeof value === "boolean" ? value : true;
}

function setHideStale(value: boolean): void {
  Application.setState(value, HIDE_STALE_KEY);
}

export class ComivexSettingsForm extends Form {
  private hideStale: boolean;

  constructor() {
    super();
    this.hideStale = getHideStale();
  }

  async updateHideStale(value: boolean): Promise<void> {
    this.hideStale = value;
    setHideStale(value);
    this.reloadForm();
  }

  override getSections() {
    return [
      Section(
        {
          id: "explore",
          footer:
            "Skip manga pinned to the top of Explore's 'Recently Updated' sort " +
            "for months with no new chapters. The Latest tab is unaffected.",
        },
        [
          ToggleRow("hide_stale_explore_entries", {
            title: "Hide stuck 'Recently Updated' entries",
            value: this.hideStale,
            onValueChange: Application.Selector<
              ComivexSettingsForm,
              (value: boolean) => Promise<void>
            >(this, "updateHideStale"),
          }),
        ],
      ),
    ];
  }
}
