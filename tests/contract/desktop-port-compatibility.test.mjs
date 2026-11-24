import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function contractDiagnostics(source) {
  const configPath = path.resolve("tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const file = path.resolve("tests/contract/desktop-port-compatibility-fixture.ts");
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    path.resolve(name) === file
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([file], parsed.options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

test("desktop port contracts expose async void results without breaking synchronous fake bridges", () => {
  const diagnostics = contractDiagnostics(`
    import type { PiBridge } from "../../src/contract/desktop";
    type PortBridge = Pick<PiBridge, "requestHostPort" | "requestEnvironmentPort">;
    const synchronous: PortBridge = {
      requestHostPort() {},
      requestEnvironmentPort(environmentId) { void environmentId; },
    };
    const asynchronous: PortBridge = {
      requestHostPort: async () => {},
      requestEnvironmentPort: async (environmentId) => { void environmentId; },
    };
    const hostAsync: ReturnType<PiBridge["requestHostPort"]> = Promise.resolve();
    const environmentAsync: ReturnType<PiBridge["requestEnvironmentPort"]> = Promise.resolve();
    const hostSync: ReturnType<PiBridge["requestHostPort"]> = undefined;
    const environmentSync: ReturnType<PiBridge["requestEnvironmentPort"]> = undefined;
    const results: (void | Promise<void>)[] = [
      synchronous.requestHostPort(), synchronous.requestEnvironmentPort("primary"),
      asynchronous.requestHostPort(), asynchronous.requestEnvironmentPort("remote-one"),
      hostAsync, environmentAsync, hostSync, environmentSync,
    ];
    void results;
  `);
  assert.deepEqual(diagnostics, []);
});

test("desktop port contracts reject promises carrying error payloads instead of void", () => {
  const diagnostics = contractDiagnostics(`
    import type { PiBridge } from "../../src/contract/desktop";
    const bridge: Pick<PiBridge, "requestHostPort" | "requestEnvironmentPort"> = {
      requestHostPort: async () => ({ error: "not a void acknowledgement" }),
      requestEnvironmentPort: async () => ({ error: "not a void acknowledgement" }),
    };
    void bridge;
  `);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    [2322, 2322],
  );
  for (const diagnostic of diagnostics) assert.match(diagnostic.message, /Promise<void>/u);
});
