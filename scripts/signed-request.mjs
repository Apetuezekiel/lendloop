#!/usr/bin/env node
// Sends an HMAC-signed request exactly the way Convex and n8n sign theirs,
// for testing the integration by hand: replays, tampering, stale timestamps.
//
//   node scripts/signed-request.mjs --url <url> --secret-env <ENV_NAME> --body '<json>'
//     [--times 2]          send the identical signed request N times (a replay)
//     [--tamper]           change the body after signing (expect 401)
//     [--age 600]          backdate the timestamp by N seconds (expect 401)
//     [--env-file n8n/.env] read the secret from a dotenv file instead of the shell
//
// The secret is read from an environment variable or env file, never from argv,
// so it does not land in shell history.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    "secret-env": { type: "string" },
    "env-file": { type: "string" },
    body: { type: "string" },
    times: { type: "string", default: "1" },
    tamper: { type: "boolean", default: false },
    age: { type: "string", default: "0" },
  },
});

if (!values.url || !values["secret-env"] || !values.body) {
  console.error("Usage: --url <url> --secret-env <ENV_NAME> --body '<json>' [--times N] [--tamper] [--age S]");
  process.exit(2);
}

function readSecret(name, file) {
  if (file) {
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  }
  return process.env[name];
}

const secret = readSecret(values["secret-env"], values["env-file"]);
if (!secret) {
  console.error(`Secret ${values["secret-env"]} not found`);
  process.exit(2);
}

const body = JSON.stringify(JSON.parse(values.body)); // normalise
const timestamp = String(Math.floor(Date.now() / 1000) - Number(values.age));
const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
const sent = values.tamper ? body.replace(/}$/, ',"tampered":true}') : body;

for (let i = 1; i <= Number(values.times); i++) {
  const res = await fetch(values.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": timestamp,
      "X-LendLoop-Signature": signature,
    },
    body: sent,
  });
  console.log(`#${i} ${res.status} ${await res.text()}`);
}
