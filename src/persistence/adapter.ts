export interface ProjectFileInput {
  readonly name?: string;
  readonly size?: number;
  text(): Promise<string>;
}

export interface ProjectDownloadInput {
  text: string | Uint8Array;
  filename: string;
  mimeType: string;
}

/**
 * The app's persistence boundary is intentionally file-like. Implementations
 * may read from a browser File, a test double, or a future host integration;
 * the editor never assumes it can write directly to a workspace filesystem.
 */
export interface PersistenceAdapter {
  readProjectFile(file: ProjectFileInput): Promise<string>;
}

export interface BrowserDownloadAdapter {
  downloadProjectFile(input: ProjectDownloadInput): void;
}

export class BrowserPersistenceAdapter implements PersistenceAdapter, BrowserDownloadAdapter {
  readProjectFile(file: ProjectFileInput): Promise<string> {
    return file.text();
  }

  downloadProjectFile(input: ProjectDownloadInput): void {
    const payload: BlobPart = typeof input.text === "string"
      ? input.text
      : input.text.slice().buffer;
    const blob = new Blob([payload], { type: input.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = input.filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
