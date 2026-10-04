export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}
