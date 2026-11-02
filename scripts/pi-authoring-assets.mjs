import YAML from "yaml";

const piPackages = ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-codemode", "pi-mcp", "pi-telemetry", "pi-tui"];

export function findMissingPiAuthoringAssets(builderConfig) {
  const files = YAML.parse(builderConfig).files ?? [];
  const required = piPackages.map((name) => ({
    from: `node_modules/@earendil-works/${name}`,
    to: `node_modules/@earendil-works/${name}`,
    filter: [
      "README.md",
      "dist/**/*.d.ts",
      ...(name === "pi-coding-agent" ? ["docs/**/*", "examples/**/*"] : []),
      ...(name === "pi-mcp" ? ["LICENSES/**/*"] : []),
    ],
  }));
  required.push(
    {
      from: "node_modules/quickjs-wasi/dist",
      to: "node_modules/quickjs-wasi/dist",
      filter: ["**/*.d.ts"],
    },
    {
      from: "node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node",
      to: "node_modules/@silvia-odwyer/photon-node",
      filter: ["LICENSE.md"],
    },
  );
  return required.flatMap((expected) => {
    const actual = files.find(
      (entry) => typeof entry === "object" && entry.from === expected.from && entry.to === expected.to,
    );
    if (!actual) return [`${expected.from} -> ${expected.to}`];
    return expected.filter
      .filter((pattern) => !actual.filter?.includes(pattern))
      .map((pattern) => `${expected.from}: ${pattern}`);
  });
}
