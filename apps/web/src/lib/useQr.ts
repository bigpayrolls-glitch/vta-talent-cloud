import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code image (data URL) for a certificate's public check page. */
export function useQr(text: string, width = 280) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!text) return;
    void QRCode.toDataURL(text, { margin: 1, width, color: { dark: '#202124', light: '#ffffff' } }).then(setSrc);
  }, [text, width]);
  return src;
}
