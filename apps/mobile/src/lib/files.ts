import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authHeaders } from './api';
import { API_URL } from './config';
import { pdfName } from './format';

/**
 * Downloads a PDF the signed-in person may read (signed agreement, complete package or
 * certificate) into the app's cache, then opens the system share sheet so they can save it to
 * Files, print it or send it. The server checks access on every download.
 */
export async function downloadAndShare(path: string, title: string, suffix = '') {
  const dir = new Directory(Paths.cache, 'documents');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, pdfName(title, suffix));
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(`${API_URL}${path}`, dest, {
    headers: await authHeaders(),
  });
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
  return file.uri;
}
