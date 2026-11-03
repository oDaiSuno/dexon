import { spawn } from "node:child_process";
import { attachHelperLink, type HelperLink } from "../host/ssh/helper-link.ts";
import { pythonBootstrapSource } from "../host/ssh/python-bootstrap.ts";
import { helperScript } from "../host/ssh/python-helper.ts";

export interface LocalHelper {
  readonly link: HelperLink;
  dispose(): Promise<void>;
}

export async function startLocalHelper(python = "/usr/bin/python3"): Promise<LocalHelper> {
  const script = helperScript();
  const child = spawn(python, ["-u", "-c", pythonBootstrapSource(script)], { stdio: ["pipe", "pipe", "pipe"] });
  const link = await attachHelperLink(child, script, { epoch: 1 });
  return {
    link,
    async dispose() {
      link.close();
      await link.closed;
    },
  };
}
