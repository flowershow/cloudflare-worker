import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { parseMarkdownFile } from './parser';
import { Client } from 'typesense';

// Initialize S3 client
function getS3Client(env) {
  const s3Config = {
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  };

  if (env.S3_REGION && env.S3_REGION !== '') {
    s3Config.region = env.S3_REGION;
  } else {
    s3Config.region = 'us-east-1'; // Default region for MinIO
  }

  return new S3Client(s3Config);
}

// Initialize Typesense client
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

// Initialize postgres client
function getPostgresClient(env) {
  return postgres(env.DATABASE_URL, {
    max: 5,
    fetch_types: false,
  });
}

async function getBlobId(sql, siteId, path) {
  const result = await sql`
    SELECT id
    FROM "Blob"
    WHERE "siteId" = ${siteId}
    AND path = ${path}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  
  if (result.length === 0) {
    throw new Error(`No blob found for path: ${path}`);
  }
  
  return result[0].id;
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

async function processFile(env, siteId, branch, path) {
  console.log('Processing request:', { siteId, branch, path });
  
  const s3Client = getS3Client(env);
  const sql = getPostgresClient(env);
  const typesense = getTypesenseClient(env);

  try {
    // Check if file is markdown
    if (!path.match(/\.(md|mdx)$/i)) {
      console.log(`Skipping non-markdown file: ${path}`);
      return;
    }

    // Get file content from S3
    const s3Key = `${siteId}/${branch}/raw/${path}`;
    console.log('Fetching from S3:', s3Key);
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: s3Key
    });

    const response = await s3Client.send(getObjectCommand);
    const content = await response.Body.transformToString();

    console.log('Processing markdown file:', path);

    // Get blobId from database
    const blobId = await getBlobId(sql, siteId, path);

    // Parse the markdown content
    const metadata = await parseMarkdownFile(content, path);

    console.log('Parsed metadata:', metadata);

    // Update blob metadata in database
    await sql`
      UPDATE "Blob"
      SET metadata = ${sql.json(metadata)},
          "updatedAt" = NOW()
      WHERE id = ${blobId}
    `;

    // Index in Typesense
    await indexInTypesense({typesense, siteId, blobId, path, content, metadata});

    console.log(`Successfully processed ${path}`);
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

export default {
  // Handle S3 events and queue them
  async fetch(request, env, ctx) {
    try {
      const { Records } = await request.json();
      
      // Validate S3 event
      if (!Records || !Array.isArray(Records)) {
        return new Response('Invalid S3 event format', { status: 400 });
      }

      // Queue each file for processing
      for (const record of Records) {
        if (!record.s3?.object?.key) {
          console.warn('Invalid record format:', record);
          continue;
        }

        console.log("Raw key:", record.s3.object.key)
        // First convert + to spaces, then decode URI (which converts %2B to +)
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        console.log('Processing S3 key:', key);
        
        // Extract components from the key
        const matches = key.match(/^([^/]+)\/([^/]+)\/raw\/(.+)$/);
        
        if (!matches) {
          console.warn(`Invalid file path format: ${key}`);
          continue;
        }

        const [, siteId, branch, path] = matches;
        console.log('Extracted components:', { siteId, branch, path });
        
        // Queue the file for processing
        await env.FILE_PROCESSOR_QUEUE.send({
          siteId,
          branch,
          path
        });
        
        console.log(`Queued for processing: ${key}`);
      }

      return new Response('Events queued for processing', { status: 200 });
    } catch (error) {
      console.error('Error handling S3 event:', error);
      return new Response(`Error handling S3 event: ${error}`, { status: 500 });
    }
  },

  // Process queued events
  async queue(batch, env, ctx) {
    try {
      for (const message of batch.messages) {
        console.log('Processing queued message:', message.body);
        const { siteId, branch, path } = message.body;
        
        if (!siteId || !branch || !path) {
          console.error('Invalid message format:', message.body);
          continue;
        }
        
        await processFile(env, siteId, branch, path);
      }
    } catch (error) {
      console.error('Error processing queued message:', error);
      throw error; // Retry the batch
    }
  }
};