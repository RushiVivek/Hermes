// Generate HERMES_PASSWORD_HASH for a new (or changed) vault password.
// Run via:    npm run hash-password
//
// Prompts twice with hidden input, then prints the env line to paste into
// .env.local and the Render dashboard. Setting a new hash signs every device
// out (the session key is derived from it — see lib/session.ts).
//
// Non-interactive:  printf '%s' "$PW" | npm run -s hash-password

import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";

function readPiped(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    process.stdin.on("error", reject);
  });
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          finish();
          resolve(buf);
          return;
        }
        if (c === "\u0003") {
          finish();
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  let password: string;
  if (process.stdin.isTTY) {
    password = await readHidden("New vault password: ");
    const again = await readHidden("Repeat it: ");
    if (password !== again) throw new Error("Passwords don't match.");
  } else {
    password = await readPiped();
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const hash = await hashPassword(password);
  console.log(`\nHERMES_PASSWORD_HASH=${hash}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error((err as Error).message);
    process.exit(1);
  },
);
