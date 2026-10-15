import { app } from "electron";
import path from "node:path";

/** Configure every platform path before loading application startup code. */
export function configureSmokeEnvironment(): string {
  const userData = process.env.PI_DESKTOP_SMOKE_USER_DATA;
  const home = process.env.PI_DESKTOP_SMOKE_HOME;
  if (!userData || !home || !path.isAbsolute(userData) || !path.isAbsolute(home)) {
    throw new Error("Smoke requires absolute disposable userData and home directories");
  }
  const temporary = process.env.TMPDIR;
  if (!temporary || !path.isAbsolute(temporary))
    throw new Error("Smoke requires an absolute disposable temp directory");
  app.setPath("temp", temporary);
  app.setPath("home", home);
  app.setPath("userData", userData);
  app.setPath("sessionData", userData);
  app.setAppLogsPath(path.join(userData, "logs"));
  return userData;
}
