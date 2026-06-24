import os, json, hashlib
from nacl.bindings import (
    crypto_scalarmult, crypto_scalarmult_base,
    crypto_secretstream_xchacha20poly1305_state as SSState,
    crypto_secretstream_xchacha20poly1305_init_push as ss_init_push,
    crypto_secretstream_xchacha20poly1305_push as ss_push,
    crypto_secretstream_xchacha20poly1305_TAG_MESSAGE as TAG_MSG,
    crypto_secretstream_xchacha20poly1305_TAG_FINAL as TAG_FINAL,
)

# Server static keypair
server_priv = os.urandom(32)
server_pub = crypto_scalarmult_base(server_priv)

# Client (simulating what the TS code will do) — but TS generates its own priv.
# For e2e we need the client's priv too. We'll let TS generate priv and give us its pub;
# but simpler: generate client priv here, compute shared, and ALSO pass client priv to TS
# so TS derives the same shared via x25519ScalarMult(clientPriv, serverPub).
client_priv = os.urandom(32)
client_pub = crypto_scalarmult_base(client_priv)
shared = crypto_scalarmult(client_priv, server_pub)

page_name = "1.webp"
key_hint = os.urandom(32)

# streamKey = SHA256(shared || pageName) XOR keyHint[:32]
sha = hashlib.sha256(shared + page_name.encode()).digest()
stream_key = bytes(sha[i] ^ key_hint[i] for i in range(32))

# Build secretstream ciphertext
MSG = os.urandom(40000)
state = SSState()
header = ss_init_push(state, stream_key)  # 24 bytes
# single chunk, final
ct = ss_push(state, MSG, None, TAG_FINAL)

prefix = os.urandom(128)
payload = prefix + header + ct

json.dump({
  "serverPub": server_pub.hex(),
  "clientPriv": client_priv.hex(),
  "pageName": page_name,
  "keyHint": key_hint.hex(),
  "payload": payload.hex(),
  "expectedPlain": hashlib.sha256(MSG).hexdigest(),
  "plainLen": len(MSG),
}, open("_e2evec.json","w"))
print("generated, payload", len(payload), "msg", len(MSG))
