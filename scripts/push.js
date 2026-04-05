import { execFileSync } from "child_process";

const msg = process.argv[2] || "AI update";

try {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"])
    .toString()
    .trim();

  console.log(`Current branch: ${branch}`);

  execFileSync("git", ["add", "."], { stdio: "inherit" });

  try {
    execFileSync("git", ["commit", "-m", msg], { stdio: "inherit" });
  } catch (e) {
    if (e.stderr?.toString().includes("nothing to commit") ||
        e.stdout?.toString().includes("nothing to commit")) {
      console.log("No changes to commit.");
      process.exit(0);
    }
    throw e;
  }

  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });

  console.log("Code pushed successfully.");
} catch (err) {
  console.error("Failed to push code:", err.message);
  process.exit(1);
}
