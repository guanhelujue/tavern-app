function extensionFromUri(uri: string) {
  const mimeType = uri.match(/^data:([^;,]+)/)?.[1];
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (mimeType?.includes('gif')) return 'gif';
  return uri.split('?')[0]?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'jpg';
}

export async function saveImageToDevice(uri: string) {
  const trimmed = uri.trim();
  if (!trimmed) throw new Error('没有可保存的图片。');

  let downloadUri = trimmed;
  let revoke = false;
  try {
    if (!trimmed.startsWith('data:')) {
      const response = await fetch(trimmed);
      if (!response.ok) throw new Error('图片下载失败。');
      downloadUri = URL.createObjectURL(await response.blob());
      revoke = true;
    }

    const anchor = document.createElement('a');
    anchor.href = downloadUri;
    anchor.download = `persona-${Date.now()}.${extensionFromUri(trimmed)}`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    if (revoke) URL.revokeObjectURL(downloadUri);
  }
}
