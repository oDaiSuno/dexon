export function pythonBootstrapSource(script: string): string {
  return `import sys;exec(sys.stdin.buffer.read(${Buffer.byteLength(script, "utf8")}).decode())`;
}

export function pythonBootstrapInput(script: string): Buffer {
  return Buffer.from(script, "utf8");
}
