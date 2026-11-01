// Streaming CSV reader (RFC 4180): quoted fields, "" escapes, commas and line breaks inside quotes, CRLF, a UTF-8
// BOM. Falls back to Latin-1 for older files (for example the UCI SMS Spam Collection's spam.csv).
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

export async function detectEncoding(file: string): Promise<BufferEncoding> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);
    // Cut at the last newline so a multi-byte character split by the 64 KB boundary isn't counted as invalid.
    const cut = head.lastIndexOf(0x0a);
    const sample = cut > 0 ? head.subarray(0, cut) : head;
    return sample.toString("utf8").includes("�") ? "latin1" : "utf8";
  } finally {
    await fh.close();
  }
}

export async function* readCsv(file: string, encoding?: BufferEncoding): AsyncGenerator<string[]> {
  const enc = encoding ?? (await detectEncoding(file));
  const stream = createReadStream(file, { encoding: enc, highWaterMark: 1 << 20 });
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let quoteSeen = false;
  let first = true;
  for await (const chunk of stream as AsyncIterable<string>) {
    let s = chunk;
    if (first) {
      s = s.replace(/^﻿/, "");
      first = false;
    }
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (inQuotes) {
        if (quoteSeen) {
          quoteSeen = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          inQuotes = false; // that quote closed the field; handle c below
        } else if (c === '"') {
          quoteSeen = true;
          continue;
        } else {
          field += c;
          continue;
        }
      }
      if (c === '"' && field === "") inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") yield row;
        row = [];
      } else if (c !== "\r") field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") yield row;
  }
}

/** First line of a file, for recognising which kind of dataset it is. */
export async function readHeader(file: string): Promise<string[]> {
  for await (const row of readCsv(file)) return row.map((h) => h.trim());
  return [];
}
