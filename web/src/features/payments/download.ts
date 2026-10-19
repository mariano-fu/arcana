/**
 * Hands a text file to her, with no network (Principle 1). Where the browser can share files
 * (iOS Safari, including the installed web app, where blob downloads are unreliable) it opens
 * the share sheet; otherwise it downloads. Call it straight from the click handler, with no
 * `await` before it: sharing needs the tap's user activation.
 */
export async function saveTextFile(filename: string, text: string, type: string): Promise<void> {
  const file = new File([text], filename, { type });
  // Older browsers have no canShare, though the DOM types say it's always there.
  if ('canShare' in navigator && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      // She closed the share sheet: nothing to do. Any other failure falls back to a download.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  downloadFile(file);
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Kept alive for a while: some browsers read the URL after click() returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}
