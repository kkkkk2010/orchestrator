import yauzl from "yauzl";
import { Readable } from "node:stream";

const openZip = (zipPath: string): Promise<yauzl.ZipFile> => {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        const detail = error instanceof Error ? error.message : "unable to open archive";
        reject(new Error(`TemplateInvalid: unable to open ${zipPath}: ${detail}`));
        return;
      }
      resolve(zipFile);
    });
  });
};

const readStreamToString = (stream: Readable): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
};

const openEntryStream = (zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> => {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("TemplateInvalid: unable to read doc.json stream"));
        return;
      }
      resolve(stream);
    });
  });
};

export const readDocJsonFromTemplateZip = async (zipPath: string): Promise<unknown> => {
  const zipFile = await openZip(zipPath);

  return new Promise((resolve, reject) => {
    let settled = false;
    let foundDoc = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      reject(error);
    };

    const succeed = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      resolve(value);
    };

    zipFile.on("error", (error) => fail(error));

    zipFile.on("entry", async (entry) => {
      if (settled) {
        return;
      }

      if (entry.fileName !== "doc.json") {
        zipFile.readEntry();
        return;
      }

      foundDoc = true;

      try {
        const stream = await openEntryStream(zipFile, entry);
        const rawDoc = await readStreamToString(stream);
        const parsed = JSON.parse(rawDoc) as unknown;
        succeed(parsed);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    zipFile.on("end", () => {
      if (!foundDoc && !settled) {
        fail(new Error("TemplateInvalid: missing doc.json"));
      }
    });

    zipFile.readEntry();
  });
};
