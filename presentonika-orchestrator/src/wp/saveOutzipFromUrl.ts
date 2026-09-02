export const saveOutzipFromUrl = async (params: {
  endpoint: string;
  presentationId: number;
  saveToken: string;
  outZipUrl: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number; responseJson: unknown | null; responseText: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(params.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Presentation-Id": String(params.presentationId),
        "X-Save-Token": params.saveToken,
      },
      body: JSON.stringify({ outZipUrl: params.outZipUrl }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let responseJson: unknown | null = null;

    try {
      responseJson = JSON.parse(responseText) as unknown;
    } catch {
      responseJson = null;
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      responseJson,
      responseText,
    };
  } finally {
    clearTimeout(timeout);
  }
};
