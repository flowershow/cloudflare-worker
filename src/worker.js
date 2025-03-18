import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { parseMarkdownFile } from './parser';

// Initialize S3 client with support for MinIO
const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

// Initialize Prisma client
const prisma = new PrismaClient();

export default {
  async fetch(request, env, ctx) {
    try {
      const { siteId, blobId, key } = await request.json();

      // Check if file is markdown
      if (!key.match(/\.(md|mdx)$/i)) {
        console.log(`Skipping non-markdown file: ${key}`);
        return new Response('Not a markdown file', { status: 200 });
      }

      // Get file content from S3
      const getObjectCommand = new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      });

      const response = await s3Client.send(getObjectCommand);
      const content = await response.Body.transformToString();

      // Parse the markdown content
      const parseResult = await parseMarkdownFile(content);
      
      if (!parseResult.success) {
        console.error(`Failed to parse markdown for ${key}:`, parseResult.error);
        return new Response('Failed to parse markdown', { status: 500 });
      }

      // Update blob metadata in database
      await prisma.blob.update({
        where: { id: blobId },
        data: {
          metadata: {
            ...parseResult.metadata,
            // Keep any existing metadata fields
            ...(await prisma.blob.findUnique({
              where: { id: blobId },
              select: { metadata: true }
            })).metadata
          }
        }
      });

      console.log(`Successfully processed ${key}`);
      return new Response('Successfully processed file', { status: 200 });

    } catch (error) {
      console.error('Error processing file:', error);
      return new Response('Error processing file', { status: 500 });
    }
  }
};