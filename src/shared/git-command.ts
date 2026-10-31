import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitCommandRunOptions {
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
}

export interface GitCommandRunner {
  run(cwd: string, args: string[], options: GitCommandRunOptions): Promise<{ stdout: string }>;
}

const defaultGitCommandRunner: GitCommandRunner = {
  async run(cwd, args, options) {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      encoding: "utf8",
      env: options.env,
    });
    return { stdout: String(stdout) };
  },
};

let gitCommandRunner: GitCommandRunner = defaultGitCommandRunner;

export function setGitCommandRunner(runner: GitCommandRunner): () => void {
  const previous = gitCommandRunner;
  gitCommandRunner = runner;
  return () => {
    if (gitCommandRunner === runner) gitCommandRunner = previous;
  };
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await gitCommandRunner.run(cwd, args, {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

export async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await gitCommandRunner.run(cwd, args, {
    timeout: 10_000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}
