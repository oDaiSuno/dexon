const results = JSON.parse(process.env.CI_NEEDS);
const required = process.argv.slice(2);
if (required.length === 0) {
  console.error("No required jobs were configured");
  process.exitCode = 1;
}
for (const job of required) {
  if (results[job]?.result !== "success") {
    console.error(`${job}: ${results[job]?.result ?? "missing"}`);
    process.exitCode = 1;
  }
}
