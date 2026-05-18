import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { shareTrade, shareAnalyst, copyText } from '../utils/share.js';
import { captureTradeShareImage, captureAnalystShareImage } from '../utils/shareImage.js';

export default function ShareMenu({ trade, analystData, entryTiming, textFormatter, filename = 'lookout-trade.png' }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [previewURL, setPreviewURL] = useState(null);   // preview modal
  const [previewBlob, setPreviewBlob] = useState(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  // Compute viewport-safe menu position whenever the menu opens
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const btnRect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 230;
    const menuHeight = 280;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Default: open below the button, right-aligned
    let top = btnRect.bottom + 6;
    let left = btnRect.right - menuWidth;

    // Flip upward if not enough room below
    if (top + menuHeight > viewportH - 8) top = btnRect.top - menuHeight - 6;
    // Keep menu inside viewport horizontally
    if (left < 8) left = 8;
    if (left + menuWidth > viewportW - 8) left = viewportW - menuWidth - 8;
    // Final safety: don't go above viewport
    if (top < 8) top = 8;

    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    const scrollHandler = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', scrollHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    };
  }, [open]);

  const flash = (msg) => { setFeedback(msg); setTimeout(() => setFeedback(''), 2000); };

  const handleShareImage = async () => {
    setBusy(true);
    setOpen(false);
    try {
      const result = analystData
        ? await captureAnalystShareImage(analystData, filename)
        : await captureTradeShareImage(trade, entryTiming, filename);
      const url = URL.createObjectURL(result.blob);
      setPreviewURL(url);
      setPreviewBlob(result.blob);
    } catch (e) {
      flash('Image generation failed');
    }
    setBusy(false);
  };

  const closePreview = () => {
    if (previewURL) URL.revokeObjectURL(previewURL);
    setPreviewURL(null); setPreviewBlob(null);
  };

  const handleDownloadPreview = () => {
    if (!previewURL) return;
    const a = document.createElement('a');
    a.href = previewURL; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    flash('Downloaded ✓');
  };

  const handleNativeShareImage = async () => {
    if (!previewBlob) return;
    const file = new File([previewBlob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${trade?.ticker || analystData?.ticker || 'Trade'} — Project Look Out` });
        flash('Shared ✓');
      } catch (e) {
        if (e.name !== 'AbortError') flash('Share failed');
      }
    } else {
      handleDownloadPreview();
    }
  };

  const handleCopyText = async () => {
    const text = textFormatter ? textFormatter() : '';
    const ok = await copyText(text);
    flash(ok ? 'Copied to clipboard ✓' : 'Copy failed');
    setOpen(false);
  };

  const handleShareText = async () => {
    const text = textFormatter ? textFormatter() : '';
    if (navigator.share) {
      try {
        await navigator.share({ text, title: `${trade?.ticker || 'Trade'} — Project Look Out` });
        flash('Shared ✓');
      } catch (e) { if (e.name !== 'AbortError') flash('Share failed'); }
    } else {
      const ok = await copyText(text);
      flash(ok ? 'Copied — paste anywhere ✓' : 'Copy failed');
    }
    setOpen(false);
  };

  const handleWhatsApp = () => {
    const text = textFormatter ? textFormatter() : '';
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    setOpen(false);
  };

  const handleTelegram = () => {
    const text = textFormatter ? textFormatter() : '';
    window.open(`https://t.me/share/url?url=&text=${encodeURIComponent(text)}`, '_blank');
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        disabled={busy}
        title="Share this trade"
        className="text-[10px] font-mono px-2 py-1 border border-[#2a2a2a] hover:border-cyan-500/40 text-[#666] hover:text-cyan-400 rounded transition-colors disabled:opacity-40"
      >
        {busy ? 'Capturing…' : '↗ Share'}
      </button>

      {feedback && (
        <span className="absolute -top-7 right-0 text-[10px] font-mono px-2 py-0.5 rounded bg-green-500/20 border border-green-500/40 text-green-300 whitespace-nowrap z-50">
          {feedback}
        </span>
      )}

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 230, zIndex: 9999 }}
          className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-lg shadow-2xl py-1"
        >
          <button onClick={handleShareImage}
            className="w-full text-left px-3 py-2 text-[11px] font-mono text-[#ccc] hover:bg-cyan-500/10 hover:text-cyan-300 flex items-center gap-2">
            <span className="text-base">🖼</span><div><div>Share as Image</div><div className="text-[9px] text-[#555]">Native share or download PNG</div></div>
          </button>
          <button onClick={handleShareText}
            className="w-full text-left px-3 py-2 text-[11px] font-mono text-[#ccc] hover:bg-cyan-500/10 hover:text-cyan-300 flex items-center gap-2">
            <span className="text-base">💬</span><div><div>Share as Text</div><div className="text-[9px] text-[#555]">Native share with formatted text</div></div>
          </button>
          <div className="border-t border-[#1a1a1a] my-1" />
          <button onClick={handleWhatsApp}
            className="w-full text-left px-3 py-2 text-[11px] font-mono text-[#ccc] hover:bg-green-500/10 hover:text-green-300 flex items-center gap-2">
            <span className="text-base">📱</span><div><div>Send to WhatsApp</div><div className="text-[9px] text-[#555]">Opens WhatsApp with text</div></div>
          </button>
          <button onClick={handleTelegram}
            className="w-full text-left px-3 py-2 text-[11px] font-mono text-[#ccc] hover:bg-blue-500/10 hover:text-blue-300 flex items-center gap-2">
            <span className="text-base">✈</span><div><div>Send to Telegram</div><div className="text-[9px] text-[#555]">Opens Telegram with text</div></div>
          </button>
          <div className="border-t border-[#1a1a1a] my-1" />
          <button onClick={handleCopyText}
            className="w-full text-left px-3 py-2 text-[11px] font-mono text-[#ccc] hover:bg-[#1a1a1a] flex items-center gap-2">
            <span className="text-base">📋</span><div><div>Copy as Text</div><div className="text-[9px] text-[#555]">Paste anywhere</div></div>
          </button>
        </div>,
        document.body
      )}

      {/* Image preview modal */}
      {previewURL && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
             onClick={closePreview}>
          <div onClick={e => e.stopPropagation()}
               style={{ background: '#0e0e0e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16, maxWidth: 800, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ color: '#cccccc', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 }}>PREVIEW · This is what you'll share</div>
              <button onClick={closePreview} style={{ color: '#888', background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <img src={previewURL} alt="Trade share preview" style={{ display: 'block', width: '100%', maxWidth: 720, borderRadius: 8, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closePreview}
                style={{ padding: '8px 14px', background: 'transparent', color: '#888', border: '1px solid #2a2a2a', borderRadius: 6, fontFamily: 'monospace', fontSize: 11, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDownloadPreview}
                style={{ padding: '8px 14px', background: '#1a3c6e', color: '#3399ff', border: '1px solid #2a5598', borderRadius: 6, fontFamily: 'monospace', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                ⤓ Download PNG
              </button>
              <button onClick={handleNativeShareImage}
                style={{ padding: '8px 14px', background: '#0a3a1f', color: '#00ff88', border: '1px solid #1a6e3c', borderRadius: 6, fontFamily: 'monospace', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                ↗ Share Now
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
