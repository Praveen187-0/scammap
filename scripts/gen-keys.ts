// npm run gen-keys
// Creates an Ed25519 key pair. The private key goes to keys/private.pem (git-ignored, keep it on your laptop);
// the public key is written into src/licence/publicKey.ts, which you DO commit and deploy.
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const keysDir = path.join(root, "keys");
const privPath = path.join(keysDir, "private.pem");
const force = process.argv.includes("--force");

if (existsSync(privPath) && !force) {
  console.error(`${privPath} already exists. Re-run with --force to replace it (old licences will stop verifying).`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

mkdirSync(keysDir, { recursive: true });
writeFileSync(privPath, privPem, { mode: 0o600 });
chmodSync(privPath, 0o600);
writeFileSync(path.join(keysDir, "public.pem"), pubPem);

const tsFile = path.join(root, "src/licence/publicKey.ts");
writeFileSync(
  tsFile,
  `// Written by \`npm run gen-keys\`. Public half of the licence key pair: safe to commit.\n` +
    `// The matching private key is keys/private.pem on the owner's laptop and must never be committed.\n` +
    `export const LICENCE_PUBLIC_KEY_PEM = ${JSON.stringify(pubPem)};\n`,
);

console.log(`Private key: ${privPath}  (never commit this; it is git-ignored)`);
console.log(`Public key written into: ${tsFile}  (commit and deploy this)`);
