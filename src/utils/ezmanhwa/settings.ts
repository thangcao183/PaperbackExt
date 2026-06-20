import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "ezmanhwa.baseUrlOverride.";
const SHOW_LOCKED_KEY_PREFIX = "ezmanhwa.showLockedChapters.";

function baseUrlKey(sourceName: string): string {
  return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

function showLockedKey(sourceName: string): string {
  return `${SHOW_LOCKED_KEY_PREFIX}${sourceName}`;
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
 * Whether locked (purchase-required) chapters should be shown. Defaults to false.
 */
export function getShowLockedChapters(sourceName: string): boolean {
  const value = Application.getState(showLockedKey(sourceName));
  return typeof value === "boolean" ? value : false;
}

function setShowLockedChapters(sourceName: string, value: boolean): void {
  Application.setState(value, showLockedKey(sourceName));
}

/**
 * Settings form for an EZManhwa source. Lets the user override the base URL
 * (useful when a site changes domain) and toggle locked-chapter visibility.
 */
export class EZManhwaSettingsForm extends Form {
  private override: string;
  private showLocked: boolean;

  constructor(
    private readonly sourceName: string,
    private readonly defaultBaseUrl: string,
  ) {
    super();
    this.override = getBaseUrlOverride(sourceName) ?? "";
    this.showLocked = getShowLockedChapters(sourceName);
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

  async updateShowLocked(value: boolean): Promise<void> {
    this.showLocked = value;
    setShowLockedChapters(this.sourceName, value);
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
              EZManhwaSettingsForm,
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
              EZManhwaSettingsForm,
              () => Promise<void>
            >(this, "resetOverride"),
          }),
        ],
      ),
      Section(
        {
          id: "chapters",
          footer:
            "Show locked chapters that require purchase in the chapter list. " +
            "They are marked with a lock icon and are not readable.",
        },
        [
          ToggleRow("show_locked_chapters", {
            title: "Show locked chapters",
            value: this.showLocked,
            onValueChange: Application.Selector<
              EZManhwaSettingsForm,
              (value: boolean) => Promise<void>
            >(this, "updateShowLocked"),
          }),
        ],
      ),
    ];
  }
}
