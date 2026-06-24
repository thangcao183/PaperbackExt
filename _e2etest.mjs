import { x25519ScalarMult, sha256, decryptSecretStream, base64Decode } from "./src/TheBlank/crypto.ts";
import { readFileSync } from "fs";
import { createHash } from "crypto";
const v = JSON.parse(readFileSync("_e2evec.json","utf8"));
const fromHex = (h) => new Uint8Array(Buffer.from(h,"hex"));
const serverPub = fromHex(v.serverPub);
const clientPriv = fromHex(v.clientPriv);
const shared = x25519ScalarMult(clientPriv, serverPub);
// streamKey = SHA256(shared || pageName) XOR keyHint
const pn = new TextEncoder().encode(v.pageName);
const hi = new Uint8Array(shared.length + pn.length);
hi.set(shared); hi.set(pn, shared.length);
const hash = await sha256(hi);
const keyHint = fromHex(v.keyHint);
const streamKey = new Uint8Array(32);
for (let i=0;i<32;i++) streamKey[i] = hash[i] ^ keyHint[i];
const payload = fromHex(v.payload);
const dec = decryptSecretStream(streamKey, payload);
if (!dec) { console.log("RESULT: null (decrypt failed)"); process.exit(1); }
const got = createHash("sha256").update(Buffer.from(dec)).digest("hex");
console.log("len", dec.length, "expected", v.plainLen);
console.log(got === v.expectedPlain ? "MATCH ✅" : "MISMATCH ❌ got "+got);
