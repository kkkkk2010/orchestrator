export const waitForHttp = async (
  url: string,
  options: {
    timeoutMs: number;
    intervalMs: number;
  }
): Promise<void> => {
  const startedAt = Date.now();

  const endpointUrl = new URL(url);
  const healthUrl = new URL("/health", endpointUrl.origin).toString();

  const isRetryableNetworkError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("etimedout") ||
      message.includes("fetch failed") ||
      message.includes("network")
    );
  };

  const isReachable = async (): Promise<boolean> => {
    try {
      const healthResponse = await fetch(healthUrl, { method: "GET" });
      if (healthResponse.status >= 200 && healthResponse.status < 500) {
        return true;
      }
    } catch (error) {
      if (!isRetryableNetworkError(error)) {
        return false;
      }
    }

    try {
      const endpointResponse = await fetch(endpointUrl.toString(), { method: "HEAD" });
      return endpointResponse.status >= 200 && endpointResponse.status < 500;
    } catch (error) {
      if (isRetryableNetworkError(error)) {
        return false;
      }

      return false;
    }
  };

  while (Date.now() - startedAt <= options.timeoutMs) {
    if (await isReachable()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }

  throw new Error(`WaitForHttpTimeout: ${url}`);
};
