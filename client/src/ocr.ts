// Reads text from a screenshot ON THE PHONE (Tesseract.js, WebAssembly). The image is never uploaded: the OCR engine
// and language files are served by our own server from /ocr, and the picture stays in the browser.
type Worker = { recognize: (img: Blob) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };

let worker: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import("tesseract.js");
      const abs = (p: string): string => new URL(p, window.location.href).href;
      return (await createWorker(["eng", "hin"], 1, {
        workerPath: abs("/ocr/worker.min.js"),
        corePath: abs("/ocr/core"),
        langPath: abs("/ocr/lang"),
        workerBlobURL: false,
        gzip: true,
      })) as unknown as Worker;
    })();
    worker.catch(() => {
      worker = null;
    });
  }
  return worker;
}

/** Shrinks big screenshots first: faster, and plenty for printed text. */
async function downscale(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (scale === 1) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/png"));
  } catch {
    return file;
  }
}

export async function readScreenshot(file: Blob): Promise<string> {
  const w = await getWorker();
  const { data } = await w.recognize(await downscale(file));
  return data.text.replace(/[ \t]+/g, " ").trim();
}
