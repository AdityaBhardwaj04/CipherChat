import { execSync } from "child_process";

const msg = process.argv[2] || "AI update";

try {
  // Get current branch name
  const branch = execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .trim();

  console.log(`📌 Current branch: ${branch}`);

  execSync("git add .", { stdio: "inherit" });
  execSync(`git commit -m "${msg}"`, { stdio: "inherit" });

  // Push current branch
  execSync(`git push -u origin ${branch}`, { stdio: "inherit" });

  console.log("✅ Code pushed successfully");
} catch (err) {
  console.error("❌ Error:", err.message);
}