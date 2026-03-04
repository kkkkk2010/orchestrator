import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import yazl from "yazl";
import { readDocJsonFromTemplateZip } from "../themes/templateZip";
import { getThemeTemplateZipPath } from "../themes/themeStore";

type QaReport = {
  missingKeysInTemplate: string[];
  textElementsWithoutPlaceholders: Array<{ slide: number; elementIndex: number }>;
};

const getAt = (doc: unknown, slide: number, elementIndex: number): Record<string, unknown> | null => {
  const slides = (doc && typeof doc === "object" && Array.isArray((doc as Record<string, unknown>).slides))
    ? ((doc as Record<string, unknown>).slides as unknown[])
    : [];
  const slideRecord = (slides[slide - 1] && typeof slides[slide - 1] === "object") ? slides[slide - 1] as Record<string, unknown> : null;
  if (!slideRecord) return null;
  const elements = Array.isArray(slideRecord.elements) ? slideRecord.elements : [];
  return (elements[elementIndex] && typeof elements[elementIndex] === "object") ? elements[elementIndex] as Record<string, unknown> : null;
};

const injectPlaceholder = (element: Record<string, unknown>, placeholder: string): boolean => {
  if (typeof element.text === "string") {
    element.text = placeholder;
    return true;
  }
  if (Array.isArray(element.runs) && element.runs.length > 0 && element.runs[0] && typeof element.runs[0] === "object") {
    const first = element.runs[0] as Record<string, unknown>;
    first.text = placeholder;
    return true;
  }
  return false;
};

const openZip = (zipPath: string): Promise<yauzl.ZipFile> => new Promise((resolve, reject) => {
  yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
    if (error || !zipFile) return reject(error ?? new Error("open zip failed"));
    resolve(zipFile);
  });
});

const rewriteDocInZip = async (templateZipPath: string, outZipPath: string, nextDocJson: string): Promise<void> => {
  const zipFile = await openZip(templateZipPath);
  const zipWriter = new yazl.ZipFile();
  const output = fs.createWriteStream(outZipPath);
  zipWriter.outputStream.pipe(output);

  await new Promise<void>((resolve, reject) => {
    let foundDoc = false;

    const fail = (err: unknown): void => reject(err instanceof Error ? err : new Error(String(err)));

    zipFile.on("entry", (entry) => {
      if (entry.fileName.endsWith("/")) {
        zipWriter.addEmptyDirectory(entry.fileName);
        zipFile.readEntry();
        return;
      }

      if (entry.fileName === "doc.json") {
        foundDoc = true;
        zipWriter.addBuffer(Buffer.from(nextDocJson, "utf8"), entry.fileName);
        zipFile.readEntry();
        return;
      }

      zipFile.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error ?? new Error("read entry failed"));
        zipWriter.addReadStream(stream, entry.fileName);
        zipFile.readEntry();
      });
    });

    zipFile.on("end", () => {
      if (!foundDoc) return fail(new Error("doc.json not found in zip"));
      zipWriter.end();
    });

    zipFile.on("error", fail);
    output.on("error", fail);
    output.on("close", () => resolve());
    zipFile.readEntry();
  });
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const themeId = args[0];
  const fromReport = args.includes("--from-report");
  const apply = args.includes("--apply");

  if (!themeId) {
    console.error("Usage: npm run template:patch -- <themeId> --from-report --apply");
    process.exit(1);
  }

  const reportPath = path.resolve(".tmp", "template-qa", `${themeId}.report.json`);
  if (!fromReport) {
    console.error("Only --from-report mode is supported.");
    process.exit(1);
  }

  const report = JSON.parse(await fsPromises.readFile(reportPath, "utf8")) as QaReport;
  if (!apply) {
    console.warn("Dry-run mode. Add --apply to write template.patched.out.zip");
    console.log(`Would patch keys: ${report.missingKeysInTemplate.join(", ")}`);
    return;
  }

  const templateZipPath = getThemeTemplateZipPath(themeId);
  const doc = await readDocJsonFromTemplateZip(templateZipPath);

  const candidates = [...report.textElementsWithoutPlaceholders];
  const patchedKeys: string[] = [];

  for (const missingKey of report.missingKeysInTemplate) {
    const slideMatch = missingKey.match(/^s(\d+)_/i);
    const targetSlide = slideMatch ? Number.parseInt(slideMatch[1], 10) : 1;
    const candidateIndex = candidates.findIndex((candidate) => candidate.slide === targetSlide);
    if (candidateIndex < 0) continue;

    const candidate = candidates[candidateIndex];
    const element = getAt(doc, candidate.slide, candidate.elementIndex);
    if (!element) continue;

    const ok = injectPlaceholder(element, `{{${missingKey}}}`);
    if (!ok) continue;

    patchedKeys.push(missingKey);
    candidates.splice(candidateIndex, 1);
  }

  const outZipPath = path.resolve(path.dirname(templateZipPath), "template.patched.out.zip");
  await rewriteDocInZip(templateZipPath, outZipPath, JSON.stringify(doc, null, 2));

  console.log(`Patched keys: ${patchedKeys.length}`);
  console.log(`Patched zip: ${outZipPath}`);
  if (patchedKeys.length < report.missingKeysInTemplate.length) {
    console.warn(`Unpatched keys: ${report.missingKeysInTemplate.filter((key) => !patchedKeys.includes(key)).join(", ")}`);
  }
};

if (require.main === module) {
  void run();
}
