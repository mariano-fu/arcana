/**
 * Saves text as a file on the device, with no network (Principle 1). On iOS Safari this opens
 * the share/download sheet, which is why the object URL is kept alive for a while.
 */
export function downloadTextFile(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}
