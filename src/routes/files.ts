import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/db.js';
import { parseStl } from '../lib/geometry.js';
import { uploadFile } from '../lib/storage.js';
import type { Env } from '../types/index.js';

const SUPPORTED_FORMATS = ['stl', 'obj', '3mf'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const files = new Hono<Env>();

function formatId(uuid: string, prefix: string): string {
  return prefix + '_' + uuid.replace(/-/g, '').slice(-8);
}

files.post('/', async (c) => {
  const accountId = c.get('account_id');
  const contentType = c.req.header('Content-Type') || '';

  let fileBuffer: Buffer;
  let originalName: string;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing "file" field in multipart form data',
            request_id: c.get('request_id'),
          },
        },
        400
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
            request_id: c.get('request_id'),
          },
        },
        400
      );
    }

    originalName = file.name;
    fileBuffer = Buffer.from(await file.arrayBuffer());
  } else if (contentType.includes('application/json')) {
    const body = await c.req.json<{ file_url?: string }>();

    if (!body.file_url) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must include "file_url"',
            request_id: c.get('request_id'),
          },
        },
        400
      );
    }

    // Download file from URL
    const res = await fetch(body.file_url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: `Failed to download file from URL: HTTP ${res.status}`,
            request_id: c.get('request_id'),
          },
        },
        400
      );
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_FILE_SIZE) {
      return c.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
            request_id: c.get('request_id'),
          },
        },
        400
      );
    }

    fileBuffer = Buffer.from(arrayBuf);
    // Extract filename from URL path
    const urlPath = new URL(body.file_url).pathname;
    originalName = urlPath.split('/').pop() || 'upload';
  } else {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Content-Type must be multipart/form-data or application/json',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Validate format
  const ext = originalName.split('.').pop()?.toLowerCase();
  if (!ext || !SUPPORTED_FORMATS.includes(ext)) {
    return c.json(
      {
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message: `Unsupported file format "${ext}". Supported: ${SUPPORTED_FORMATS.join(', ')}`,
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  const fileId = randomUUID();
  const storageKey = `files/${accountId}/${fileId}.${ext}`;

  const mimeTypes: Record<string, string> = {
    stl: 'model/stl',
    obj: 'model/obj',
    '3mf': 'model/3mf',
  };
  await uploadFile(storageKey, fileBuffer, mimeTypes[ext] || 'application/octet-stream');

  // Parse geometry for STL files
  let volumeCm3: number | null = null;
  let boundingBox: { x: number; y: number; z: number } | null = null;

  if (ext === 'stl') {
    try {
      const result = parseStl(fileBuffer);
      volumeCm3 = result.volume_cm3;
      boundingBox = result.bounding_box;
    } catch (err) {
      console.warn('[files] STL parse failed:', err);
      // Non-fatal: we'll store the file without geometry data
    }
  }

  // Insert record
  const { data, error } = await supabase
    .from('files')
    .insert({
      id: fileId,
      account_id: accountId,
      original_name: originalName,
      storage_key: storageKey,
      size_bytes: fileBuffer.byteLength,
      format: ext,
      volume_cm3: volumeCm3,
      bounding_box: boundingBox,
    })
    .select()
    .single();

  if (error) {
    console.error('[files] insert error:', error);
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Failed to store file record',
          request_id: c.get('request_id'),
        },
      },
      500
    );
  }

  return c.json(
    {
      file_id: formatId(data.id, 'file'),
      original_name: data.original_name,
      format: data.format,
      size_bytes: data.size_bytes,
      volume_cm3: data.volume_cm3,
      bounding_box: data.bounding_box,
      created_at: data.created_at,
    },
    201
  );
});

export default files;
