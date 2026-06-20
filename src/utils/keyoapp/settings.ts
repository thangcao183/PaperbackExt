import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "keyoapp.baseUrlOverride.";
const SHOW_PAID_KEY_PREFIX = "keyoapp.showPaidChapters.";

function baseUrlKey(sourceName: string): string {
  return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

function showPaidKey(sourceName: string): string {
  return `${SHOW_PAID_KEY_PREFIX}${sourceName}`;
}

/**
 * Returns the user-configured base URL override for a source, or undefined
 * when none is set. Trailing slashes are stripped.
 */
export function getBaseUrlOverride(sourceName: string): string | undefined {
  const value = Application.getState(baseUrlKey(sourceName));
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function setBaseUrlOverride(sourceName: string, value: string): void {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(trimmed, baseUrlKey(sourceName));
}

/**
 * Whether paid (locked) chapters should be shown. Defaults to false.
 */
export function getShowPaidChapters(sourceName: string): boolean {
  const value = Application.getState(showPaidKey(sourceName));
  return typeof value === "boolean" ? value : false;
}

function setShowPaidChapters(sourceName: string, value: boolean): void {
  Application.setState(value, showPaidKey(sourceName));
}

/**
 * Settings form for a Keyoapp source. Lets the user override the base URL
 * (useful when a site changes domain) and toggle paid-chapter visibility.
 */
export class KeyoappSettingsForm extends Form {
  private override: string;
  private showPaid: boolean;

  constructor(
    private readonly sourceName: string,
    private readonly defaultBaseUrl: string,
  ) {
    super();
    this.override = getBaseUrlOverride(sourceName) ?? "";
    this.showPaid = getShowPaidChapters(sourceName);
  }

  async updateOverride(value: string): Promise<void> {
    this.override = value;
    setBaseUrlOverride(this.sourceName, value);
    this.reloadForm();
  }

  async resetOverride(): Promise<void> {
    this.override = "";
    setBaseUrlOverride(this.sourceName, "");
    this.reloadForm();
  }

  async updateShowPaid(value: boolean): Promise<void> {
    this.showPaid = value;
    setShowPaidChapters(this.sourceName, value);
    this.reloadForm();
  }

  override getSections() {
    const effective =
      this.override.trim().length > 0
        ? this.override.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new " +
            "domain. Leave empty to use the default. Include the scheme, " +
            `e.g. ${this.defaultBaseUrl}`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.override,
            onValueChange: Application.Selector<
              KeyoappSettingsForm,
              (value: string) => Promise<void>
            >(this, "updateOverride"),
          }),
          LabelRow("base_url_current", {
            title: "Currently using",
            value: effective,
          }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector<
              KeyoappSettingsForm,
              () => Promise<void>
            >(this, "resetOverride"),
          }),
        ],
      ),
      Section(
        {
          id: "chapters",
          footer:
            "Show paid/locked chapters in the chapter list. They are marked " +
            "with a lock icon and may not be readable.",
        },
        [
          ToggleRow("show_paid_chapters", {
            title: "Show paid chapters",
            value: this.showPaid,
            onValueChange: Application.Selector<
              KeyoappSettingsForm,
              (value: boolean) => Promise<void>
            >(this, "updateShowPaid"),
          }),
        ],
      ),
    ];
  }
}
