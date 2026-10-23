import type { CodeLineTokens } from "./highlighted-lines";

export function CodeLineText({ tokens }: { tokens: CodeLineTokens | undefined }) {
  return (
    <>
      {tokens?.map((token, index) =>
        token.className ? (
          <span key={index} className={token.className}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </>
  );
}
