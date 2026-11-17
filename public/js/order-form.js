/**
 * Order form controller for imastik.
 * Handles quantity & pricing sync, reference photo dropzone,
 * napkin sketch canvas, microphone voice notes, and mailto / server submission modes.
 */

const VALID_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_MAX_PHOTOS = 8;
const DEFAULT_MAX_FILE_BYTES = 15 * 1024 * 1024;
const MIN_QUANTITY = 5;
const MAX_QUANTITY = 200;
const QUANTITY_STEP = 5;

function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

export function calculateStickerPrice(quantity) {
  const parsed = Number.parseInt(quantity, 10);
  const n = Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, Number.isNaN(parsed) ? MIN_QUANTITY : parsed));
  if (n <= 5) return 5;
  if (n <= 10) return roundCents(5 + (n - 5) * 0.6);
  if (n <= 20) return roundCents(8 + (n - 10) * 0.7);
  return roundCents(15 + (n - 20) * 0.75);
}

function formatEuro(amount) {
  return `€${Number(amount).toFixed(2)}`;
}

export function initOrderForm({ reducedMotion = false } = {}) {
  const form = document.getElementById('orderForm');
  const qtyNum = document.getElementById('qtyNum');
  const minusBtn = document.getElementById('minus');
  const plusBtn = document.getElementById('plus');
  const totalEl = document.getElementById('total');
  const summaryLabel = document.getElementById('studioSummaryLabel');
  const summaryPrice = document.getElementById('studioSummaryPrice');
  const packPills = document.querySelectorAll('.pack-pill[data-pack]');

  const progressBar = document.getElementById('studioProgressBar');
  const progressText = document.getElementById('studioProgressText');
  const nameInput = form?.querySelector('[name="name"]');
  const emailInput = form?.querySelector('[name="email"]');
  const ideaInput = form?.querySelector('[name="idea"]');

  const refsInput = document.getElementById('reference');
  const dropZone = document.getElementById('referenceDrop');
  const gallery = document.getElementById('referenceGallery');
  const fileInfo = document.getElementById('fileInfo');

  const voiceBtn = document.getElementById('voiceToggle');
  const voiceTimer = document.getElementById('voiceTimer');
  const voicePreview = document.getElementById('voicePreview');
  const voiceSave = document.getElementById('voiceSave');
  const voiceHelp = document.getElementById('voiceHelp');

  const napkinCanvas = document.getElementById('napkinCanvas');
  const sketchExpandBtn = document.getElementById('sketchExpand');
  const sketchUndoBtn = document.getElementById('sketchUndo');
  const sketchClearBtn = document.getElementById('sketchClear');
  const sketchSaveLink = document.getElementById('sketchSave');
  const penButtons = document.querySelectorAll('.pen-dot[data-pen]');

  const sketchModal = document.getElementById('sketchModal');
  const napkinCanvasFull = document.getElementById('napkinCanvasFull');
  const sketchModalRotateBtn = document.getElementById('sketchModalRotate');
  const sketchModalUndoBtn = document.getElementById('sketchModalUndo');
  const sketchModalClearBtn = document.getElementById('sketchModalClear');
  const sketchModalDoneBtn = document.getElementById('sketchModalDone');
  const penButtonsModal = document.querySelectorAll('.pen-dot-modal[data-pen]');

  const submitBtn = document.getElementById('submitBtn');
  const submitBtnText = document.getElementById('submitBtnText');
  const attachmentReminder = document.getElementById('attachmentReminder');
  const paymentSteps = document.getElementById('paymentSteps');
  const storePickBanner = document.getElementById('storePickBanner');
  const storePickTitle = document.getElementById('storePickTitle');
  const storePickClear = document.getElementById('storePickClear');
  const errorBox = document.getElementById('formError');
  const resultBox = document.getElementById('orderResult');

  if (!form) return null;

  let qty = MIN_QUANTITY;
  let selectedStoreDesign = null;
  let config = {
    teamEmail: '',
    hasTeamEmail: false,
    orderMode: 'mailto',
    autoEmailEnabled: false,
    maxPhotos: DEFAULT_MAX_PHOTOS,
    maxFileSizeBytes: DEFAULT_MAX_FILE_BYTES,
  };

  // Reference photos: { file: File, url: string }
  let picked = [];

  // Voice recording state
  let recorder = null;
  let stream = null;
  let voiceParts = [];
  let voiceStart = 0;
  let voiceInterval = null;
  let voiceUrl = null;
  let voiceBlob = null;
  let voiceFilename = 'imastik-voice-note.webm';

  // Napkin sketch state
  let sketchColor = '#294b38';
  let hasSketch = false;

  function renderDirectPaymentSteps(inboxEmail) {
    if (!paymentSteps) return;
    paymentSteps.replaceChildren();
    const lead = document.createElement('strong');
    lead.textContent = 'How paying works:';
    const inbox = document.createElement('strong');
    inbox.textContent = inboxEmail || 'imastik.co@gmail.com';
    paymentSteps.append(
      lead,
      ' Submitting your idea is free — no extra design fee for standard designs and no card needed here. When you hit Send, your idea, photos, sketch, and voice note go straight to ',
      inbox,
      ', and we’ll reply with your design preview plus payment options (Revolut, bank transfer, or cash) before printing.',
    );
  }

  // --- Config fetch ---
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) {
        config = { ...config, teamEmail: 'imastik.co@gmail.com', hasTeamEmail: true };
        return;
      }
      config = { ...config, ...data };
      if (config.orderMode === 'server') {
        if (submitBtnText) submitBtnText.textContent = 'SEND MY ORDER';
        if (attachmentReminder) {
          attachmentReminder.textContent =
            'Your uploaded photos, napkin sketch, and voice note will be sent directly with your order.';
        }
        renderDirectPaymentSteps(config.teamEmail);
      }
    })
    .catch(() => {
      // Static-host / offline fallback uses imastik team email
      config = { ...config, teamEmail: 'imastik.co@gmail.com', hasTeamEmail: true };
    });

  // --- Quantity & pricing ---
  function setQuantity(nextQty) {
    const parsed = Number.parseInt(nextQty, 10);
    qty = Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, Number.isNaN(parsed) ? MIN_QUANTITY : parsed));
    const totalFormatted = formatEuro(calculateStickerPrice(qty));
    if (qtyNum) qtyNum.textContent = String(qty);
    if (totalEl) totalEl.textContent = totalFormatted;
    if (summaryLabel) {
      summaryLabel.textContent = selectedStoreDesign
        ? `1 Store design (${selectedStoreDesign.title}) + ${qty} printed stickers`
        : `1 custom design (included) + ${qty} printed stickers`;
    }
    if (summaryPrice) summaryPrice.textContent = totalFormatted;

    packPills.forEach((pill) => {
      const packQty = Number.parseInt(pill.dataset.pack || '5', 10);
      pill.classList.toggle('is-active', qty === packQty);
    });

    if (selectedStoreDesign && storePickTitle) {
      storePickTitle.textContent = `${selectedStoreDesign.title} (${qty} copies · ${totalFormatted})`;
    }
  }

  minusBtn?.addEventListener('click', () => setQuantity(qty - QUANTITY_STEP));
  plusBtn?.addEventListener('click', () => setQuantity(qty + QUANTITY_STEP));

  packPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      setQuantity(Number.parseInt(pill.dataset.pack || '5', 10));
    });
  });

  setQuantity(MIN_QUANTITY);

  // --- Progress bar & idea prompt pills ---
  function refreshProgress() {
    const count =
      Number(Boolean(nameInput?.value.trim())) +
      Number(Boolean(emailInput?.value.trim())) +
      Number(Boolean(ideaInput?.value.trim()));
    if (progressBar) progressBar.style.width = `${(count / 3) * 100}%`;
    if (progressText) progressText.textContent = `${count} / 3`;
  }

  form.addEventListener('input', refreshProgress);
  form.addEventListener('change', refreshProgress);
  refreshProgress();

  document.querySelectorAll('.idea-prompt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!ideaInput) return;
      const phrase = btn.dataset.prompt || '';
      ideaInput.value = (ideaInput.value.trim() ? `${ideaInput.value.trim()}\n` : '') + phrase;
      ideaInput.dispatchEvent(new Event('input', { bubbles: true }));
      ideaInput.focus();
      ideaInput.setSelectionRange(ideaInput.value.length, ideaInput.value.length);
    });
  });

  // --- Reference photo gallery ---
  function isValidPhoto(file) {
    return Boolean(file && VALID_IMAGE_TYPES.has(file.type) && file.size <= config.maxFileSizeBytes);
  }

  function refreshGallery(extraNotice = '') {
    if (!gallery || !fileInfo) return;
    gallery.replaceChildren();

    picked.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'ref-item';

      const img = document.createElement('img');
      img.src = entry.url;
      img.alt = `Preview of ${entry.file.name}`;

      const label = document.createElement('small');
      label.textContent = entry.file.name;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(entry.url);
        picked.splice(idx, 1);
        refreshGallery();
      });

      item.append(img, label, remove);
      gallery.appendChild(item);
    });

    if (picked.length > 0) {
      fileInfo.textContent =
        config.orderMode === 'server'
          ? `${picked.length} image${picked.length === 1 ? '' : 's'} ready to upload with your order.`
          : `${picked.length} image${picked.length === 1 ? '' : 's'} ready. Remember to attach ${picked.length === 1 ? 'it' : 'them'} to your email draft.${extraNotice}`;
    } else {
      fileInfo.textContent = `Add any photos or inspiration — they are optional.${extraNotice}`;
    }
  }

  function addPhotos(fileList) {
    let skipped = 0;
    for (const file of fileList) {
      if (!isValidPhoto(file) || picked.length >= config.maxPhotos) {
        skipped++;
        continue;
      }
      const duplicate = picked.some(
        (x) =>
          x.file.name === file.name &&
          x.file.size === file.size &&
          x.file.lastModified === file.lastModified,
      );
      if (!duplicate) {
        picked.push({ file, url: URL.createObjectURL(file) });
      }
    }
    const notice = skipped
      ? ` (${skipped} file${skipped === 1 ? '' : 's'} skipped — JPG/PNG/WebP under 15 MB, max ${config.maxPhotos}.)`
      : '';
    refreshGallery(notice);
  }

  refsInput?.addEventListener('change', () => {
    addPhotos(Array.from(refsInput.files || []));
    refsInput.value = '';
  });

  if (dropZone) {
    ['dragenter', 'dragover'].forEach((ev) => {
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragging');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      addPhotos(Array.from(e.dataTransfer?.files || []));
    });
  }

  // --- Voice Note Recorder ---
  function stopVoiceClock() {
    clearInterval(voiceInterval);
    voiceInterval = null;
  }

  voiceBtn?.addEventListener('click', async () => {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      voiceBtn.textContent = 'Record again';
      stopVoiceClock();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      if (voiceHelp) {
        voiceHelp.textContent =
          'Voice recording requires Safari/Chrome on HTTPS or localhost. You can attach a phone voice memo instead.';
      }
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      voiceParts = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceParts.push(e.data);
      };

      recorder.onstop = () => {
        stopVoiceClock();
        stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(voiceParts, { type: recorder.mimeType || 'audio/webm' });
        voiceBlob = blob;
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        voiceFilename = `imastik-voice-note.${ext}`;
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
        voiceUrl = URL.createObjectURL(blob);
        if (voicePreview) {
          voicePreview.src = voiceUrl;
          voicePreview.hidden = false;
        }
        if (voiceSave) {
          voiceSave.href = voiceUrl;
          voiceSave.download = voiceFilename;
          voiceSave.hidden = false;
        }
        if (voiceHelp) {
          voiceHelp.textContent =
            config.orderMode === 'server'
              ? 'Voice note ready — it will upload automatically with your order.'
              : 'Voice note recorded. Click Save voice note to attach it to your email draft.';
        }
      };

      recorder.start();
      voiceStart = Date.now();
      if (voiceTimer) voiceTimer.textContent = '00:00';
      voiceInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - voiceStart) / 1000);
        if (voiceTimer) {
          voiceTimer.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
        }
      }, 500);
      voiceBtn.textContent = 'Stop recording';
      if (voiceHelp) voiceHelp.textContent = 'Recording… tap Stop when you are done.';
    } catch {
      if (voiceHelp) {
        voiceHelp.textContent =
          'Microphone permission was unavailable. Allow microphone access or record in Voice Memos instead.';
      }
      stream?.getTracks().forEach((t) => t.stop());
    }
  });

  // --- Napkin Sketch Canvas (inline + fullscreen modal) ---
  let inlineDirty = false;
  let modalHasSketch = false;
  let modalRotatedLandscape = false;
  let modalDesktopPortrait = false;
  const sketchStage = napkinCanvasFull?.closest('.sketch-modal-stage') || null;
  const isModalRotated = () => Boolean(sketchModal?.classList.contains('is-rotated'));

  function getInkBounds(sourceCanvas) {
    const sourceCtx = sourceCanvas?.getContext('2d');
    if (!sourceCanvas || !sourceCtx || !sourceCanvas.width || !sourceCanvas.height) return null;
    const { width, height } = sourceCanvas;
    const { data } = sourceCtx.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = rowOffset + x * 4;
        if (data[i] < 248 || data[i + 1] < 245 || data[i + 2] < 235) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) return null;
    const pad = 3;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    const right = Math.min(width - 1, maxX + pad);
    const bottom = Math.min(height - 1, maxY + pad);
    return {
      x,
      y,
      w: right - x + 1,
      h: bottom - y + 1,
    };
  }

  function drawInkPreserved(
    ctx,
    targetW,
    targetH,
    sourceCanvas,
    { sourceScale = 1, targetScale = 1, margin = 8 } = {},
  ) {
    ctx.fillStyle = '#fffdf5';
    ctx.fillRect(0, 0, targetW, targetH);
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return;

    if (targetW === sourceCanvas.width && targetH === sourceCanvas.height && Math.abs(targetScale - sourceScale) < 0.001) {
      ctx.drawImage(sourceCanvas, 0, 0);
      return;
    }

    const bounds = getInkBounds(sourceCanvas);
    if (!bounds) return;

    const unitRatio = sourceScale > 0 ? targetScale / sourceScale : 1;
    const naturalW = bounds.w * unitRatio;
    const naturalH = bounds.h * unitRatio;
    const pad = Math.min(margin, Math.floor(Math.min(targetW, targetH) * 0.08));
    const availW = Math.max(1, targetW - pad * 2);
    const availH = Math.max(1, targetH - pad * 2);
    const fit = Math.min(1, availW / naturalW, availH / naturalH);

    const drawW = naturalW * fit;
    const drawH = naturalH * fit;
    const dx = (targetW - drawW) / 2;
    const dy = (targetH - drawH) / 2;
    ctx.drawImage(sourceCanvas, bounds.x, bounds.y, bounds.w, bounds.h, dx, dy, drawW, drawH);
  }

  function createSketchSurface(canvas, strokeCssWidth, { onStrokeStart, onUndo, onClear, isRotated } = {}) {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;

    const undoStack = [];
    let drawing = false;
    let last = null;
    let currentDpr = 1;
    let masterCanvas = null;
    let masterDpr = 1;
    let snapshotDirty = false;

    const fillBg = () => {
      ctx.fillStyle = '#fffdf5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const pushUndo = () => {
      if (undoStack.length >= 20) undoStack.shift();
      undoStack.push({
        image: ctx.getImageData(0, 0, canvas.width, canvas.height),
        hadSketch: hasSketch,
      });
    };

    const getStrokeScale = () => {
      if (canvas.clientWidth > 0) return canvas.width / canvas.clientWidth;
      const r = canvas.getBoundingClientRect();
      const visualW = isRotated?.() ? r.height : r.width;
      return visualW > 0 ? canvas.width / visualW : 1;
    };

    const getPoint = (e) => {
      const r = canvas.getBoundingClientRect();
      if (isRotated?.()) {
        return {
          x: r.height > 0 ? ((e.clientY - r.top) * canvas.width) / r.height : 0,
          y: r.width > 0 ? ((r.right - e.clientX) * canvas.height) / r.width : 0,
        };
      }
      return {
        x: r.width > 0 ? ((e.clientX - r.left) * canvas.width) / r.width : 0,
        y: r.height > 0 ? ((e.clientY - r.top) * canvas.height) / r.height : 0,
      };
    };

    fillBg();

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      pushUndo();
      drawing = true;
      hasSketch = true;
      snapshotDirty = true;
      onStrokeStart?.();
      last = getPoint(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported on synthetic pointer events
      }
      const lineWidth = strokeCssWidth * getStrokeScale();
      ctx.beginPath();
      ctx.arc(last.x, last.y, lineWidth * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = sketchColor;
      ctx.fill();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      snapshotDirty = true;
      const p = getPoint(e);
      const lineWidth = strokeCssWidth * getStrokeScale();
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = sketchColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      last = p;
    });

    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => {
      canvas.addEventListener(ev, () => {
        drawing = false;
      });
    });

    return {
      canvas,
      ctx,
      fillBg,
      isDrawing() {
        return drawing;
      },
      resetHistory() {
        undoStack.length = 0;
      },
      pushUndo,
      undo() {
        const snap = undoStack.pop();
        if (!snap) return;
        ctx.putImageData(snap.image, 0, 0);
        hasSketch = snap.hadSketch;
        snapshotDirty = true;
        onUndo?.(snap.hadSketch);
      },
      clear() {
        pushUndo();
        fillBg();
        hasSketch = false;
        masterCanvas = null;
        snapshotDirty = false;
        onClear?.();
      },
      copyFrom(sourceCanvas, sourceScale = 1, targetScale = currentDpr) {
        masterCanvas = null;
        snapshotDirty = true;
        drawInkPreserved(ctx, canvas.width, canvas.height, sourceCanvas, {
          sourceScale,
          targetScale,
        });
      },
      getDpr() {
        return currentDpr;
      },
      resizeTo(cssWidth, cssHeight, dpr = 1, preserveContent = true) {
        const targetW = Math.max(1, Math.round(cssWidth * dpr));
        const targetH = Math.max(1, Math.round(cssHeight * dpr));
        if (targetW === canvas.width && targetH === canvas.height && currentDpr === dpr) return false;

        if (preserveContent && hasSketch) {
          if (snapshotDirty || !masterCanvas) {
            masterCanvas = document.createElement('canvas');
            masterCanvas.width = canvas.width;
            masterCanvas.height = canvas.height;
            masterCanvas.getContext('2d')?.drawImage(canvas, 0, 0);
            masterDpr = currentDpr;
            snapshotDirty = false;
          }
        } else {
          masterCanvas = null;
          snapshotDirty = false;
        }

        canvas.width = targetW;
        canvas.height = targetH;
        currentDpr = dpr;
        undoStack.length = 0;
        if (preserveContent && hasSketch && masterCanvas) {
          drawInkPreserved(ctx, canvas.width, canvas.height, masterCanvas, {
            sourceScale: masterDpr,
            targetScale: dpr,
          });
        } else {
          fillBg();
        }
        return true;
      },
    };
  }

  function setPenColor(color) {
    sketchColor = color || '#294b38';
    [...penButtons, ...penButtonsModal].forEach((b) => {
      b.classList.toggle('active', b.dataset.pen === sketchColor);
    });
  }

  const inlineSurface = createSketchSurface(napkinCanvas, 3.2, {
    onStrokeStart: () => {
      inlineDirty = true;
    },
    onUndo: (restoredHadSketch) => {
      inlineDirty = true;
      if (!restoredHadSketch) modalHasSketch = false;
    },
    onClear: () => {
      inlineDirty = false;
      modalHasSketch = false;
    },
  });

  const fullSurface = createSketchSurface(napkinCanvasFull, 4, {
    isRotated: isModalRotated,
    onStrokeStart: () => {
      modalHasSketch = true;
      inlineDirty = false;
    },
    onUndo: (restoredHadSketch) => {
      modalHasSketch = restoredHadSketch;
    },
    onClear: () => {
      modalHasSketch = false;
      inlineDirty = false;
    },
  });

  function getExportCanvas() {
    if (modalHasSketch && !inlineDirty && napkinCanvasFull) {
      return napkinCanvasFull;
    }
    return napkinCanvas;
  }

  if (inlineSurface) {
    [...penButtons, ...penButtonsModal].forEach((btn) => {
      btn.addEventListener('click', () => setPenColor(btn.dataset.pen));
    });

    sketchUndoBtn?.addEventListener('click', () => inlineSurface.undo());
    sketchClearBtn?.addEventListener('click', () => inlineSurface.clear());
    sketchSaveLink?.addEventListener('click', (e) => {
      const targetCanvas = getExportCanvas();
      if (targetCanvas) e.currentTarget.href = targetCanvas.toDataURL('image/png');
    });
  }

  function applyModalOrientation() {
    if (!sketchModal) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const portraitViewport = vh > vw;
    const activeRotated = portraitViewport && modalRotatedLandscape;
    const activeDesktopPortrait = !portraitViewport && modalDesktopPortrait;

    if (portraitViewport) {
      sketchModal.style.setProperty('--modal-rot-w', `${vh}px`);
      sketchModal.style.setProperty('--modal-rot-h', `${vw}px`);
    } else {
      sketchModal.style.removeProperty('--modal-rot-w');
      sketchModal.style.removeProperty('--modal-rot-h');
    }

    sketchModal.classList.toggle('is-rotated', activeRotated);
    sketchStage?.classList.toggle('is-portrait-stage', activeDesktopPortrait);
    if (sketchModalRotateBtn) {
      const active = activeRotated || activeDesktopPortrait;
      sketchModalRotateBtn.classList.toggle('is-active', active);
      sketchModalRotateBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function syncFullCanvasSize({ preserve = true } = {}) {
    if (!sketchStage || !fullSurface || !sketchModal || sketchModal.classList.contains('hidden')) return;
    const cw = sketchStage.clientWidth;
    const ch = sketchStage.clientHeight;
    if (cw < 1 || ch < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fullSurface.resizeTo(cw, ch, dpr, preserve);
  }

  const getInlineScale = () =>
    napkinCanvas && napkinCanvas.clientWidth > 0 ? napkinCanvas.width / napkinCanvas.clientWidth : 1;

  function closeSketchModal() {
    if (!sketchModal || sketchModal.classList.contains('hidden')) return;
    if (inlineSurface && fullSurface) {
      inlineSurface.pushUndo();
      inlineSurface.copyFrom(fullSurface.canvas, fullSurface.getDpr(), getInlineScale());
    }
    sketchModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  if (sketchModal && fullSurface && inlineSurface) {
    sketchExpandBtn?.addEventListener('click', () => {
      const shouldCopyInline = !hasSketch || inlineDirty || !modalHasSketch;
      sketchModal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      applyModalOrientation();
      syncFullCanvasSize({ preserve: !shouldCopyInline });
      if (shouldCopyInline) {
        fullSurface.resetHistory();
        if (hasSketch) {
          fullSurface.copyFrom(inlineSurface.canvas, getInlineScale(), fullSurface.getDpr());
        } else {
          fullSurface.fillBg();
        }
        inlineDirty = false;
      }
    });

    sketchModalRotateBtn?.addEventListener('click', () => {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      if (vh > vw) {
        modalRotatedLandscape = !modalRotatedLandscape;
      } else {
        modalDesktopPortrait = !modalDesktopPortrait;
      }
      applyModalOrientation();
      syncFullCanvasSize({ preserve: true });
    });

    if (typeof ResizeObserver === 'function' && sketchStage) {
      const ro = new ResizeObserver(() => {
        if (!sketchModal.classList.contains('hidden') && !fullSurface.isDrawing()) {
          applyModalOrientation();
          syncFullCanvasSize({ preserve: true });
        }
      });
      ro.observe(sketchStage);
    }

    window.addEventListener('resize', () => {
      if (!sketchModal.classList.contains('hidden') && !fullSurface.isDrawing()) {
        applyModalOrientation();
        syncFullCanvasSize({ preserve: true });
      }
    });

    sketchModalUndoBtn?.addEventListener('click', () => fullSurface.undo());
    sketchModalClearBtn?.addEventListener('click', () => fullSurface.clear());
    sketchModalDoneBtn?.addEventListener('click', closeSketchModal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sketchModal.classList.contains('hidden')) {
        closeSketchModal();
      }
    });
  }

  function getSketchBlob() {
    const exportCanvas = getExportCanvas();
    if (!exportCanvas || !hasSketch) return Promise.resolve(null);
    return new Promise((resolve) => {
      exportCanvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  // --- Form Submission ---
  function showError(msg) {
    if (!errorBox) return;
    if (!msg) {
      errorBox.classList.add('hidden');
      errorBox.textContent = '';
    } else {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    }
  }

  function buildOrderSummaryText({ name, email, idea, sharePermission, storePermission }) {
    const price = formatEuro(calculateStickerPrice(qty));
    const lines = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Sticker pack: 1 ${selectedStoreDesign ? 'Store archive' : 'custom graphic'} design (included) + ${qty} printed stickers`,
      `Estimated total: ${price} (paid via Revolut, bank transfer, or cash after design preview approval)`,
      ...(selectedStoreDesign ? [`Selected Store design: ${selectedStoreDesign.title} (#${selectedStoreDesign.id})`] : []),
      '',
      `Idea: ${idea || '(See attached photos / sketch / voice note)'}`,
      '',
      `Timelapse contact: ${
        sharePermission ? 'Yes — you may contact me; separate approval required before sharing.' : 'No'
      }`,
      `Public Store permission: ${
        storePermission ? 'Yes — may list my finished design in the imastik Store after confirmation.' : 'No'
      }`,
    ];
    const attachments = [];
    if (picked.length) attachments.push(`${picked.length} reference image(s)`);
    if (hasSketch) attachments.push('1 napkin sketch PNG');
    if (voiceBlob) attachments.push('1 voice note audio');
    if (attachments.length) {
      lines.push('', `Attachments prepared: ${attachments.join(', ')}.`);
    }
    return lines.join('\n');
  }

  function appendMailtoBackupControls({ name, email, idea, sharePermission, storePermission, autoLaunch = false }) {
    if (!resultBox) return;
    const subjectText = `imastik sticker request — ${name}`;
    const bodyText = buildOrderSummaryText({ name, email, idea, sharePermission, storePermission });
    const recipient = config.hasTeamEmail ? config.teamEmail : '';
    const mailtoHref = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(
      subjectText,
    )}&body=${encodeURIComponent(bodyText)}`;

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const mailLink = document.createElement('a');
    mailLink.className = 'result-btn primary';
    mailLink.href = mailtoHref;
    mailLink.textContent = 'Open Email App';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'result-btn';
    copyBtn.textContent = 'Copy Order Details';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`${subjectText}\n\n${bodyText}`);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy Order Details';
        }, 2000);
      } catch {
        copyBtn.textContent = 'Copy unavailable';
      }
    });

    actions.append(mailLink, copyBtn);
    resultBox.append(actions);

    const downloads = document.createElement('div');
    downloads.className = 'result-downloads';

    const exportCanvas = getExportCanvas();
    if (hasSketch && exportCanvas) {
      const a = document.createElement('a');
      a.className = 'result-btn';
      a.href = exportCanvas.toDataURL('image/png');
      a.download = 'imastik-sketch.png';
      a.textContent = 'Download Sketch PNG';
      downloads.appendChild(a);
    }

    if (voiceUrl) {
      const a = document.createElement('a');
      a.className = 'result-btn';
      a.href = voiceUrl;
      a.download = voiceFilename;
      a.textContent = 'Download Voice Note';
      downloads.appendChild(a);
    }

    if (downloads.childElementCount > 0) {
      const attachHint = document.createElement('p');
      attachHint.textContent = 'Quick downloads to attach to your email:';
      resultBox.append(attachHint, downloads);
    }

    if (autoLaunch && config.hasTeamEmail) {
      window.location.href = mailtoHref;
    }
  }

  async function renderMailtoResult({ name, email, idea, sharePermission, storePermission }) {
    if (!resultBox) return;
    resultBox.replaceChildren();
    resultBox.classList.remove('hidden');

    const heading = document.createElement('h4');
    heading.textContent = 'Your sticker request draft is ready!';

    const copy = document.createElement('p');
    copy.textContent = config.hasTeamEmail
      ? `Next step: send the pre-filled email to ${config.teamEmail} (attach your sketch/voice note if saved). We'll reply with a design preview and Revolut / bank transfer / cash payment details before printing.`
      : 'Next step: click "Open Email App", enter the imastik team email address, and hit send (don\'t forget any downloaded sketch or voice note). We\'ll reply with your design preview and payment options (Revolut, bank transfer, or cash) before printing.';

    resultBox.append(heading, copy);
    appendMailtoBackupControls({ name, email, idea, sharePermission, storePermission, autoLaunch: true });
    resultBox.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest' });
  }

  async function submitToServer({ name, email, idea, sharePermission, storePermission }) {
    const fd = new FormData();
    fd.set('name', name);
    fd.set('email', email);
    fd.set('idea', idea);
    fd.set('quantity', String(qty));
    fd.set('sharePermission', sharePermission ? 'yes' : 'no');
    fd.set('storePermission', storePermission ? 'yes' : 'no');
    if (selectedStoreDesign?.id) {
      fd.set('storeDesignId', selectedStoreDesign.id);
    }

    picked.forEach((entry) => {
      fd.append('photos', entry.file, entry.file.name);
    });

    const sketchBlob = await getSketchBlob();
    if (sketchBlob) {
      fd.append('sketch', sketchBlob, 'imastik-sketch.png');
    }

    if (voiceBlob) {
      fd.append('voiceNote', voiceBlob, voiceFilename);
    }

    const res = await fetch('/api/orders', { method: 'POST', body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Could not submit order. Please try again.');
    }

    if (resultBox) {
      const targetInbox = config.teamEmail || 'imastik.co@gmail.com';
      resultBox.replaceChildren();
      resultBox.classList.remove('hidden');

      const heading = document.createElement('h4');
      heading.textContent = data.emailSent ? `Order sent to ${targetInbox}!` : 'Order saved — finish sending by email';

      const details = document.createElement('p');
      const summaryLine = `Reference ID: ${data.orderId} · ${data.quantity} sticker${
        data.quantity === 1 ? '' : 's'
      } (${data.estimatedPriceFormatted}) · ${data.filesCount} attachment${
        data.filesCount === 1 ? '' : 's'
      }.`;
      details.textContent = data.emailSent
        ? `${summaryLine} We emailed your idea and files directly to ${targetInbox} and will reply to ${email} with your design preview before printing.`
        : `${summaryLine} Automatic email delivery is not active yet — click "Open Email App" below so your request reaches ${targetInbox} right away.`;

      resultBox.append(heading, details);

      if (Array.isArray(data.omittedAttachments) && data.omittedAttachments.length > 0) {
        const omitNote = document.createElement('p');
        omitNote.textContent = `Note: ${data.omittedAttachments.join(', ')} exceeded the 18 MB email size cap and was saved on the server without email attachment.`;
        resultBox.append(omitNote);
      }

      if (!data.emailSent) {
        appendMailtoBackupControls({ name, email, idea, sharePermission, storePermission, autoLaunch: false });
      }

      resultBox.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest' });
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');

    const name = String(nameInput?.value || '').trim();
    const email = String(emailInput?.value || '').trim();
    const idea = String(ideaInput?.value || '').trim();
    const sharePermission = Boolean(form.querySelector('[name="share_permission"]')?.checked);
    const storePermission = Boolean(form.querySelector('[name="store_permission"]')?.checked);

    if (!name) {
      showError('Please enter your name.');
      nameInput?.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Please enter a valid email address.');
      emailInput?.focus();
      return;
    }

    const previousBtnLabel = submitBtnText?.textContent || '';
    if (submitBtn) submitBtn.disabled = true;
    if (config.orderMode === 'server' && submitBtnText) {
      submitBtnText.textContent = 'SENDING ORDER...';
    }
    try {
      if (config.orderMode === 'server') {
        await submitToServer({ name, email, idea, sharePermission, storePermission });
      } else {
        await renderMailtoResult({ name, email, idea, sharePermission, storePermission });
      }
    } catch (err) {
      showError(err?.message || 'Something went wrong while preparing your order.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (submitBtnText && previousBtnLabel) {
        submitBtnText.textContent = previousBtnLabel;
      }
    }
  });

  function stripStorePickLine(rawText) {
    return String(rawText || '').replace(/^Store design pick: [^\n]+\n*/i, '');
  }

  function clearStoreSelection() {
    selectedStoreDesign = null;
    storePickBanner?.classList.add('hidden');
    if (ideaInput) {
      ideaInput.value = stripStorePickLine(ideaInput.value);
    }
    setQuantity(qty);
    refreshProgress();
  }

  function selectStoreDesign(design, preferredQty = MIN_QUANTITY) {
    if (!design?.id || !design?.title) return;
    selectedStoreDesign = { id: design.id, title: design.title };
    storePickBanner?.classList.remove('hidden');
    setQuantity(preferredQty);
    if (ideaInput) {
      const rest = stripStorePickLine(ideaInput.value).trimStart();
      const prefix = `Store design pick: ${design.title} (#${design.id})`;
      ideaInput.value = rest ? `${prefix}\n${rest}` : prefix;
    }
    refreshProgress();
    document.getElementById('order')?.scrollIntoView({
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
    const focusTarget = nameInput?.value.trim() ? ideaInput : nameInput;
    focusTarget?.focus({ preventScroll: true });
  }

  storePickClear?.addEventListener('click', clearStoreSelection);

  function addExternalPhotos(fileList) {
    addPhotos(Array.from(fileList || []));
  }

  return { setQuantity, selectStoreDesign, addExternalPhotos };
}
