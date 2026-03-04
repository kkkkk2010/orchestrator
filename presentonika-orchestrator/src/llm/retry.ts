export const isRetryableLlmError = (error: unknown, retryOnAbort: boolean): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  const isAbort = error.name === "AbortError"
    || message.includes("aborted")
    || message.includes("the user aborted a request");

  if (isAbort) {
    return retryOnAbort;
  }

  return (
    message.includes("econnreset")
    || message.includes("etimedout")
    || message.includes("enotfound")
    || message.includes("eai_again")
    || message.includes("429")
    || message.includes("503")
    || message.includes("502")
    || message.includes("fetch failed")
    || message.includes("network")
  );
};

export const calcLlmRetryDelayMs = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
  const backoff = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 200);
  return backoff + jitter;
};
