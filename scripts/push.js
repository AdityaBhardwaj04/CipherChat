import { execSync } from "child_process";

const msg = process.argv[2] || "AI update";

try {
  execSync("git add .", { stdio: "inherit" });
  execSync(`git commit -m "${msg}"`, { stdio: "inherit" });
  execSync("git push origin main", { stdio: "inherit" });

  console.log("✅ Code pushed successfully");
} catch (err) {
  console.error("❌ Error:", err.message);
}