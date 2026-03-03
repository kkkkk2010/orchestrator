import fs from "node:fs/promises";
import path from "node:path";

export const uploadOutzip = async (params: {
  endpoint: string;
  presentationId: number;
  saveToken: string;
  zipPath: string;
  timeoutMs: number;
}): Promise<{
  ok: boolean;
  status: number;
  responseText: string;
  responseJson: unknown | null;
}> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const resolvedZipPath = path.resolve(params.zipPath);
    const zipBuffer = await fs.readFile(resolvedZipPath);

    const formData = new FormData();
    formData.append("presentationId", String(params.presentationId));
    formData.append("saveToken", params.saveToken);
    formData.append("file", new Blob([zipBuffer], { type: "application/zip" }), "out.zip");

    const response = await fetch(params.endpoint, {
      method: "POST",
      body: formData,
      headers: {
        "X-Save-Token": params.saveToken,
        "X-Presentation-Id": String(params.presentationId),
      },
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
      ok: response.ok,
      status: response.status,
      responseText,
      responseJson,
    };
  } finally {
    clearTimeout(timeout);
  }
};
