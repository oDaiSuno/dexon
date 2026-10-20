import assert from "node:assert/strict";
import test from "node:test";
import { isNetworkFailure, networkFailureCode } from "./network-failure.ts";

function coded(message, code) {
  return Object.assign(new Error(message), { code });
}

function fetchFailed(cause) {
  return new TypeError("fetch failed", { cause });
}

test("a connection refused buried in the fetch failure cause is recognised and named", () => {
  const failure = fetchFailed(coded("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"));
  assert.equal(isNetworkFailure(failure), true);
  assert.equal(networkFailureCode(failure), "ECONNREFUSED");
});

test("a network code several causes deep is still found", () => {
  const failure = fetchFailed(
    new Error("socket wrapper", { cause: coded("connect timeout", "UND_ERR_CONNECT_TIMEOUT") }),
  );
  assert.equal(isNetworkFailure(failure), true);
  assert.equal(networkFailureCode(failure), "UND_ERR_CONNECT_TIMEOUT");
});

test("any failing address inside an aggregate error makes the whole attempt a network failure", () => {
  const failure = new AggregateError(
    [coded("connect ENETUNREACH", "ENETUNREACH"), coded("getaddrinfo EAI_AGAIN", "EAI_AGAIN")],
    "all addresses failed",
  );
  assert.equal(isNetworkFailure(failure), true);
  assert.equal(networkFailureCode(failure), "ENETUNREACH");
});

test("a body stream terminated by a reset is recognised through its cause", () => {
  const failure = new TypeError("terminated", { cause: coded("read ECONNRESET", "ECONNRESET") });
  assert.equal(isNetworkFailure(failure), true);
  assert.equal(networkFailureCode(failure), "ECONNRESET");
});

test("the socket error Node really raises when the peer closes mid-body is recognised", () => {
  const failure = new TypeError("terminated", { cause: coded("other side closed", "UND_ERR_SOCKET") });
  assert.equal(isNetworkFailure(failure), true);
  assert.equal(networkFailureCode(failure), "UND_ERR_SOCKET");
});

test("a cause cycle ends the search instead of recursing forever", () => {
  const first = new Error("first");
  const second = new Error("second");
  first.cause = second;
  second.cause = first;
  assert.equal(isNetworkFailure(first), false);
  assert.equal(networkFailureCode(first), undefined);
});

test("a Chromium net failure named by the Electron adapter is recognised", () => {
  assert.equal(isNetworkFailure(coded("net::ERR_INTERNET_DISCONNECTED", "ERR_INTERNET_DISCONNECTED")), true);
  assert.equal(networkFailureCode(coded("net::ERR_CONNECTION_RESET", "ERR_CONNECTION_RESET")), "ERR_CONNECTION_RESET");
  assert.equal(isNetworkFailure(coded("net::ERR_TIMED_OUT", "ERR_TIMED_OUT")), true);
});

test("Chromium certificate, blocked and invalid-URL failures are not network failures", () => {
  for (const name of [
    "ERR_CERT_AUTHORITY_INVALID",
    "ERR_CERT_COMMON_NAME_INVALID",
    "ERR_BLOCKED_BY_CLIENT",
    "ERR_INVALID_URL",
  ]) {
    assert.equal(isNetworkFailure(coded(`net::${name}`, name)), false);
    assert.equal(networkFailureCode(coded(`net::${name}`, name)), undefined);
  }
});

test("codes that are not network conditions are not classified as network failures", () => {
  assert.equal(isNetworkFailure(coded("checksum mismatch", "TOOLCHAIN_INTEGRITY_FAILED")), false);
  assert.equal(isNetworkFailure(coded("permission denied", "EACCES")), false);
  assert.equal(isNetworkFailure(fetchFailed(new Error("plain wrapper"))), false);
});

test("values that are not error objects are not network failures", () => {
  for (const value of [undefined, null, "ECONNRESET", 42, { code: 7 }]) {
    assert.equal(isNetworkFailure(value), false);
    assert.equal(networkFailureCode(value), undefined);
  }
});
