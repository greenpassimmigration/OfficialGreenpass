// src/api/integrations.js
// Real Firebase-backed integrations (safe, tree-shakeable)

// ---- LLM (real call via Vercel function)
export async function InvokeLLM(args = {}) {
  const res = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`LLM error: ${msg || res.status}`);
  }

  return res.json();
}

// ---- Email (enqueue to Firestore 'mail' for Trigger Email extension)
// Backward-compatible with callers that send { body, text } or { html, text }
export async function SendEmail({
  to,
  subject,
  text,
  html,
  body,
  from,
  replyTo,
  headers,
  cc,
  bcc,
}) {
  if (!to || !subject || (!text && !html && !body)) {
    throw new Error(
      'SendEmail: "to", "subject", and one of "text" | "html" | "body" are required.'
    );
  }

  const { db } = await import('@/firebase');
  const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');

  const toList = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  const ccList = cc ? (Array.isArray(cc) ? cc.filter(Boolean) : [cc]) : undefined;
  const bccList = bcc ? (Array.isArray(bcc) ? bcc.filter(Boolean) : [bcc]) : undefined;

  if (!toList.length) {
    throw new Error('SendEmail: at least one valid recipient is required.');
  }

  const ENV_FROM =
    import.meta.env.VITE_EMAIL_FROM &&
    String(import.meta.env.VITE_EMAIL_FROM).trim();

  // Important:
  // Prefer caller-provided `from` first.
  // This allows invoice emails to use the same allowed sender as invitations,
  // e.g. GreenPass <info@greenpassgroup.com>.
  // If no caller sender is provided, fall back to VITE_EMAIL_FROM.
  // If neither exists, omit `from` and let the Firebase Email Extension default apply.
  const fromHeader =
    from && typeof from === 'string' && from.includes('@')
      ? from
      : ENV_FROM || undefined;

  const effectiveHtml = html ?? body ?? undefined;

  const payload = {
    to: toList,
    ...(ccList ? { cc: ccList } : {}),
    ...(bccList ? { bcc: bccList } : {}),
    ...(fromHeader ? { from: fromHeader } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(headers && typeof headers === 'object' ? { headers } : {}),
    createdAt: serverTimestamp(),
    message: {
      subject,
      ...(text ? { text } : {}),
      ...(effectiveHtml ? { html: effectiveHtml } : {}),
    },
    _meta: {
      app: 'GreenPass',
      reason: headers?.['X-GreenPass-Reason'] || 'General',
    },
  };

  const ref = await addDoc(collection(db, 'mail'), payload);

  return {
    success: true,
    id: ref.id,
    queued: true,
    to: toList,
    from: fromHeader || 'extension-default',
  };
}

/**
 * Upload a file to Firebase Storage and return a downloadable URL.
 *
 * @param {Object} params
 * @param {File|Blob} params.file - Browser File/Blob to upload
 * @param {string} [params.path]  - Optional folder path, e.g. "events/evt_123/cover"
 * @param {(progress:number)=>void} [params.onProgress] - Optional progress callback (0..100)
 *
 * @returns {Promise<{ file_url: string, storage_path: string, size: number, content_type: string }>}
 */
export async function UploadFile({ file, path, onProgress }) {
  if (!file) throw new Error('UploadFile: "file" is required');

  const { storage } = await import('@/firebase');
  const { ref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');

  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
  const safeName = (file.name || `file.${ext}`).replace(/[^\w.\-]/g, '_');
  const folder = path || `uploads/${new Date().toISOString().slice(0, 10)}`;
  const storagePath = `${folder}/${Date.now()}_${safeName}`;

  const storageRef = ref(storage, storagePath);
  const metadata = { contentType: file.type || 'application/octet-stream' };
  const task = uploadBytesResumable(storageRef, metadata ? file : file, metadata);

  await new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress) {
          const pct = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );
          try {
            onProgress(pct);
          } catch {
            // ignore callback errors
          }
        }
      },
      reject,
      resolve
    );
  });

  const file_url = await getDownloadURL(task.snapshot.ref);

  return {
    file_url,
    storage_path: storagePath,
    size: task.snapshot.totalBytes,
    content_type: metadata.contentType,
  };
}

// ---- Image generation (kept as stub)
export async function GenerateImage() {
  console.warn('GenerateImage called – image generation disabled.');
  return { url: 'https://example.com/stub-image' };
}