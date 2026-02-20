import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import yauzl from "yauzl";
import yazl from "yazl";

const OUT_DIR = "out";

type AssembleZipInput = {
  templateZipPath: string;
  jobId: string;
  updatedDocJsonString: string;
  replacements?: Record<string, string>;
};

export type AssembleZipResult = {
  outZipPath: string;
  replacedEntryPaths: string[];
  missingEntryPaths: string[];
};

const openZip = (zipPath: string): Promise<yauzl.ZipFile> => {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error(`AssembleFailed: unable to open zip ${zipPath}`));
        return;
      }
      resolve(zipFile);
    });
  });
};

const openEntryStream = (zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> => {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`AssembleFailed: unable to read entry ${entry.fileName}`));
        return;
      }
      resolve(stream);
    });
  });
};

export const assembleZip = async ({
  templateZipPath,
  jobId,
  updatedDocJsonString,
  replacements = {},
}: AssembleZipInput): Promise<AssembleZipResult> => {
  const outDirPath = path.resolve(OUT_DIR);
  await fsPromises.mkdir(outDirPath, { recursive: true });

  const outFileName = `${jobId}.out.zip`;
  const outRelativePath = path.join(OUT_DIR, outFileName);
  const outAbsolutePath = path.resolve(outRelativePath);

  const replacementEntries = new Set(Object.keys(replacements));
  const replacedEntryPaths = new Set<string>();

  const zipFile = await openZip(templateZipPath);
  const zipWriter = new yazl.ZipFile();
  const outputStream = fs.createWriteStream(outAbsolutePath);

  zipWriter.outputStream.pipe(outputStream);

  return new Promise<AssembleZipResult>((resolve, reject) => {
    let settled = false;
    let foundDocJson = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      zipWriter.end();
      reject(error);
    };

    const succeed = (): void => {
      if (settled) {
        return;
      }
      settled = true;

      const missingEntryPaths = [...replacementEntries].filter((entryPath) => !replacedEntryPaths.has(entryPath));

      resolve({
        outZipPath: outRelativePath,
        replacedEntryPaths: [...replacedEntryPaths],
        missingEntryPaths,
      });
    };

    outputStream.on("error", (error) => fail(error instanceof Error ? error : new Error(String(error))));
    outputStream.on("close", succeed);
    zipFile.on("error", (error) => fail(error));

    zipFile.on("entry", async (entry) => {
      if (settled) {
        return;
      }

      try {
        if (entry.fileName.endsWith("/")) {
          zipWriter.addEmptyDirectory(entry.fileName);
          zipFile.readEntry();
          return;
        }

        if (entry.fileName === "doc.json") {
          foundDocJson = true;
          zipWriter.addBuffer(Buffer.from(updatedDocJsonString, "utf8"), "doc.json");
          zipFile.readEntry();
          return;
        }

        const replacementFilePath = replacements[entry.fileName];
        if (replacementFilePath) {
          zipWriter.addFile(replacementFilePath, entry.fileName);
          replacedEntryPaths.add(entry.fileName);
          zipFile.readEntry();
          return;
        }

        const stream = await openEntryStream(zipFile, entry);
        zipWriter.addReadStream(stream, entry.fileName);
        zipFile.readEntry();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    zipFile.on("end", () => {
      if (!foundDocJson) {
        fail(new Error("TemplateInvalid: missing doc.json"));
        return;
      }

      zipWriter.end();
      zipFile.close();
    });

    zipFile.readEntry();
  });
};
