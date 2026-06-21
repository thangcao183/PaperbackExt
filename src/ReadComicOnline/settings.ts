import { Form, Section, SelectRow } from "@paperback/types";

export const MIRROR_OPTIONS = [
  { id: "https://readcomiconline.li", title: "readcomiconline.li" },
  { id: "https://rcostation.xyz", title: "rcostation.xyz" },
];
export const DEFAULT_BASE_URL = "https://rcostation.xyz";

export const QUALITY_OPTIONS = [
  { id: "hq", title: "High" },
  { id: "lq", title: "Low" },
];

export const SERVER_OPTIONS = [
  { id: "", title: "Server 1" },
  { id: "s2", title: "Server 2" },
];

const MIRROR_KEY = "readcomiconline.mirror";
const QUALITY_KEY = "readcomiconline.quality";
const SERVER_KEY = "readcomiconline.server";

export function getMirrorBaseUrl(): string {
  const value = Application.getState(MIRROR_KEY);
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

function setMirrorBaseUrl(value: string): void {
  Application.setState(value, MIRROR_KEY);
}

export function getQuality(): string {
  const value = Application.getState(QUALITY_KEY);
  return typeof value === "string" && value.length > 0 ? value : "hq";
}

function setQuality(value: string): void {
  Application.setState(value, QUALITY_KEY);
}

export function getServer(): string {
  const value = Application.getState(SERVER_KEY);
  return typeof value === "string" ? value : "";
}

function setServer(value: string): void {
  Application.setState(value, SERVER_KEY);
}

export class ReadComicOnlineSettingsForm extends Form {
  private mirror: string;
  private quality: string;
  private server: string;

  constructor() {
    super();
    this.mirror = getMirrorBaseUrl();
    this.quality = getQuality();
    this.server = getServer();
  }

  async updateMirror(value: string[]): Promise<void> {
    const selected = value[0] ?? DEFAULT_BASE_URL;
    this.mirror = selected;
    setMirrorBaseUrl(selected);
    this.reloadForm();
  }

  async updateQuality(value: string[]): Promise<void> {
    const selected = value[0] ?? "hq";
    this.quality = selected;
    setQuality(selected);
    this.reloadForm();
  }

  async updateServer(value: string[]): Promise<void> {
    const selected = value[0] ?? "";
    this.server = selected;
    setServer(selected);
    this.reloadForm();
  }

  override getSections() {
    return [
      Section({ id: "mirror", footer: "Select which mirror domain to use." }, [
        SelectRow("mirror_select", {
          title: "Mirror",
          value: [this.mirror],
          options: MIRROR_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            ReadComicOnlineSettingsForm,
            (value: string[]) => Promise<void>
          >(this, "updateMirror"),
        }),
      ]),
      Section({ id: "image", footer: "Image quality and image server." }, [
        SelectRow("quality_select", {
          title: "Image quality",
          value: [this.quality],
          options: QUALITY_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            ReadComicOnlineSettingsForm,
            (value: string[]) => Promise<void>
          >(this, "updateQuality"),
        }),
        SelectRow("server_select", {
          title: "Image server",
          value: [this.server],
          options: SERVER_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            ReadComicOnlineSettingsForm,
            (value: string[]) => Promise<void>
          >(this, "updateServer"),
        }),
      ]),
    ];
  }
}
