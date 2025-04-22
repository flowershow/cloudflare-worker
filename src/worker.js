import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { Client } from 'typesense';
import { parseMarkdownFile } from './parser';

// --- CONFIGURATION & VALIDATION ---
const REQUIRED_ENV_VARS = ['DATABASE_URL'];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB max for safety

function validateEnv(env) {
  for (const v of REQUIRED_ENV_VARS) {
    if (!env[v]) throw new Error(`Missing required env var: ${v}`);
  }
}

// --- CLIENT INITIALIZATION ---
function getStorageClient(env) {
  if (env.ENVIRONMENT === 'dev') {
    const s3Client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    return { type: 's3', client: s3Client, bucket: env.S3_BUCKET };
  } else {
    return { type: 'r2', client: env.BUCKET, bucket: null };
  }
}

function getPostgresClient(env) {
  return postgres(env.DATABASE_URL, {
    max: 1, // Minimize connections since we can't reuse them
    idle_timeout: 2, // Reduce idle timeout since we'll create new connections
    fetch_types: false,
  });
}

function getTypesenseClient(env) {
  return new Client({
    nodes: [
      {
        host: env.TYPESENSE_HOST,
        port: parseInt(env.TYPESENSE_PORT),
        protocol: env.TYPESENSE_PROTOCOL,
      },
    ],
    apiKey: env.TYPESENSE_API_KEY,
    connectionTimeoutSeconds: 2,
  });
}

// --- HELPERS ---
async function getBlobId(sql, siteId, path) {
  const rows = await sql`
    SELECT id FROM \"Blob\"
    WHERE \"siteId\" = ${siteId}
      AND path     = ${path}
    ORDER BY \"createdAt\" DESC
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error(`No blob found for path: ${path}`);
  return rows[0].id;
}

async function indexInTypesense({typesense, siteId, blobId, path, content, metadata}) {
  try {
    // Create document for indexing
    const document = {
      title: metadata.title,
      content: content,
      path,
      description: metadata.description,
      authors: metadata.authors,
      date: metadata.date ? new Date(metadata.date).getTime() / 1000 : null,
      id: `${blobId}`, // Unique ID for the document
    };

    // Index the document
    await typesense.collections(siteId).documents().upsert(document);
    console.log(`Successfully indexed document: ${`${siteId} - ${path}`}`);
  } catch {
    console.error(`Failed indexing document: ${`${siteId} - ${path}`}`)
  }
}

async function processFile({ storage, sql, typesense, siteId, branch, path }) {
  console.log('Getting blob ID for:', { siteId, path });
  const blobId = await getBlobId(sql, siteId, path);
  console.log('Found blob ID:', blobId);

  try {
    const key = `${siteId}/${branch}/raw/${path}`;
    console.log('Fetching content for key:', key);
    
    let content;
    if (storage.type === 's3') {
      console.log('Using S3 storage');
      const resp = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: key })
      );
      const length = resp.ContentLength;
      console.log('S3 response:', { contentLength: length });
      if (length > MAX_FILE_BYTES) throw new Error(`File too large: ${length}`);
      content = await resp.Body.transformToString();
    } else {
      console.log('Using R2 storage');
      const obj = await storage.client.get(key);
      if (!obj) throw new Error(`Object not found: ${key}`);
      const length = obj.size;
      console.log('R2 response:', { size: length });
      if (length > MAX_FILE_BYTES) throw new Error(`File too large: ${length}`);
      content = await obj.text();
    }
    console.log('Successfully retrieved content');

    // 3) Parse markdown
    console.log('Parsing markdown file');
    const metadata = await parseMarkdownFile(content, path);
    console.log('Successfully parsed markdown');

    // 4) Update DB metadata
    console.log('Updating blob metadata:', { blobId });
    await sql`
      UPDATE \"Blob\"
      SET metadata = ${sql.json(metadata)},
          \"syncStatus\" = 'SUCCESS',
          \"syncError\"  = NULL
      WHERE id = ${blobId};
    `;
    await indexInTypesense({typesense, siteId, blobId, path, content, metadata});
    console.log('Successfully updated blob metadata');
  } catch (e) {
    console.error('Error in processFile:', {
      error: {
        message: e.message,
        stack: e.stack,
        name: e.name
      }
    });
    // 4) Update DB metadata
    console.log('Updating blob with error status');
    await sql`
      UPDATE \"Blob\"
      SET \"syncStatus\" = 'ERROR',
          \"syncError\"  = ${e.message}
      WHERE id = ${blobId};
    `;
    throw e; // Re-throw to be caught by handleMessage
  }
}

// --- MESSAGE HANDLER ---
async function handleMessage({ msg, storage, sql, typesense }) {
  try {
    console.log('Processing message:', JSON.stringify(msg.body, null, 2));
    
    const rawKey = msg.body.object.key;
    console.log('Parsing key:', rawKey);
    
    const m = rawKey.match(/^([^/]+)\/([^/]+)\/raw\/(.+)$/);
    if (!m) throw new Error(`Invalid key format: ${rawKey}`);
    const [, siteId, branch, path] = m;
    console.log('Parsed components:', { siteId, branch, path });

    if (!/^[\w-]+$/.test(siteId) || !/^[\w-]+$/.test(branch)) {
      throw new Error(`Invalid siteId or branch: ${siteId}, ${branch}`);
    }
    if (!path.match(/\.(md|mdx)$/i)) {
      console.log({ siteId, path }, 'Skipping non-markdown file');
      return msg.ack();
    }

    console.log('Processing file:', { siteId, branch, path });
    await processFile({ storage, sql, typesense, siteId, branch, path });
    console.log('Successfully processed file');
    msg.ack();
  } catch (err) {
    console.error({
      key: msg.body.object.key,
      error: {
        message: err.message,
        stack: err.stack,
        name: err.name
      }
    }, 'Error processing message');
    // Let Cloudflare handle retries
  }
}

export default {
  // HTTP endpoint (health + dev adapter)
  async fetch(request, env, ctx) {
    validateEnv(env);
    const url = new URL(request.url);

    if (env.ENVIRONMENT === 'dev' && url.pathname === '/queue') {
      let event;
      try {
        event = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }
      const rawKey = event.Records?.[0]?.s3?.object?.key;
      if (!rawKey) {
        return new Response('Bad S3 event', { status: 400 });
      }
      // Spaces in object keys from Minio are encoded as +
      const decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      await env.FILE_PROCESSOR_QUEUE.send({ object: { key: decodedKey } });
      return new Response('Queued', { status: 200 });
    }

    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  },

  // Queue consumer entry point
  async queue(batch, env, ctx) {
    validateEnv(env);
    const storage = getStorageClient(env);
    const sql = getPostgresClient(env);
    const typesense = getTypesenseClient(env);

    // Process all messages in parallel
    await Promise.all(batch.messages.map(msg => handleMessage({ msg, storage, sql, typesense })));
  },
};