import { isNetworkFailure } from "../src/main/toolchains/network-failure.ts";

const OFFLINE_DOWNLOAD_CODE = "TOOLCHAIN_DOWNLOAD_OFFLINE";

export function httpDownloadFailure(url, status) {
  return Object.assign(new Error(`[bundled-tools] ${url} returned HTTP ${status}`), { httpStatus: status });
}

export function isRetryableDownloadFailure(error) {
  if (isNetworkFailure(error)) return true;
  if (error?.code === OFFLINE_DOWNLOAD_CODE) return true;
  return typeof error?.httpStatus === "number" && error.httpStatus >= 500;
}
