import { Form, InputRow, LabelRow, Section } from "@paperback/types";
const USERNAME_KEY = "madokami.username";
const PASSWORD_KEY = "madokami.password";
export function getUsername() {
    const value = Application.getState(USERNAME_KEY);
    return typeof value === "string" ? value : "";
}
export function getPassword() {
    const value = Application.getState(PASSWORD_KEY);
    return typeof value === "string" ? value : "";
}
function setUsername(value) {
    Application.setState(value, USERNAME_KEY);
}
function setPassword(value) {
    Application.setState(value, PASSWORD_KEY);
}
/**
 * Returns the HTTP Basic Authorization header value for the stored
 * credentials, or undefined when no username has been configured.
 */
export function getBasicAuthHeader() {
    const username = getUsername();
    const password = getPassword();
    if (!username)
        return undefined;
    const encoded = Application.base64Encode(`${username}:${password}`);
    const b64 = typeof encoded === "string"
        ? encoded
        : Application.arrayBufferToUTF8String(encoded);
    return `Basic ${b64}`;
}
/**
 * Settings form for Madokami. The site requires HTTP Basic authentication
 * for every request (including the homepage), so the user must enter their
 * account credentials here before any content will load.
 */
export class MadokamiSettingsForm extends Form {
    username;
    password;
    constructor() {
        super();
        this.username = getUsername();
        this.password = getPassword();
    }
    async updateUsername(value) {
        this.username = value;
        setUsername(value);
        this.reloadForm();
    }
    async updatePassword(value) {
        this.password = value;
        setPassword(value);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({
                id: "credentials",
                footer: "Madokami requires a registered account. Enter your username " +
                    "and password to load the homepage, search, and read chapters.",
            }, [
                InputRow("username_input", {
                    title: "Username",
                    value: this.username,
                    onValueChange: Application.Selector(this, "updateUsername"),
                }),
                InputRow("password_input", {
                    title: "Password",
                    value: this.password,
                    isSecureEntry: true,
                    onValueChange: Application.Selector(this, "updatePassword"),
                }),
                LabelRow("status", {
                    title: "Status",
                    value: this.username ? "Credentials saved" : "Not logged in",
                }),
            ]),
        ];
    }
}
