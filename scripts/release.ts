import { execSync } from "child_process";
import * as readline from "readline";

const pkg = await Bun.file("package.json").json();
const currentVersion: string = pkg.version;

console.log(`\nCurrent version: ${currentVersion}\n`);
console.log("Select release type:");
console.log("  1) patch  (bug fixes)");
console.log("  2) minor  (new features)");
console.log("  3) major  (breaking changes)");
console.log("  q) quit\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const answer = await new Promise<string>((resolve) => {
  rl.question("Choice [1/2/3/q]: ", (input) => {
    rl.close();
    resolve(input.trim());
  });
});

const typeMap: Record<string, string> = {
  "1": "patch",
  "2": "minor",
  "3": "major",
};

const releaseType = typeMap[answer];

if (!releaseType) {
  console.log("Aborted.");
  process.exit(0);
}

console.log(`\nBumping ${releaseType} version...`);

execSync(`npm version ${releaseType}`, { stdio: "inherit" });
execSync("git push --follow-tags", { stdio: "inherit" });

console.log("\nTag pushed! GitHub Actions will handle the npm publish.");
