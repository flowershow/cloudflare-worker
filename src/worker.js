import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { parseMarkdownFile } from './parser';

export default {
  async fetch(request, env, ctx) {
    try {
      // Initialize S3 client with support for MinIO
      const s3Config = {
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
      };

      // Add region only if it's provided, otherwise let SDK use default
      if (env.S3_REGION && env.S3_REGION !== '') {
        s3Config.region = env.S3_REGION;
      } else {
        s3Config.region = 'us-east-1'; // Default region for MinIO
      }

      const s3Client = new S3Client(s3Config);

      // Initialize postgres client with connection pooling limits
      const sql = postgres(env.DATABASE_URL, {
        max: 5, // Limit concurrent connections for Workers
        fetch_types: false, // Disable type fetching since we don't use array types
      });

      const { siteId, blobId, path, branch } = await request.json();

      // Validate required parameters
      if (!siteId || !blobId || !path || !branch) {
        return new Response('Missing required parameters: siteId, blobId, path', { 
          status: 400 
        });
      }

      // Check if file is markdown
      if (!path.match(/\.(md|mdx)$/i)) {
        console.log(`Skipping non-markdown file: ${path}`);
        return new Response('Not a markdown file', { status: 200 });
      }

      // Get file content from S3
      const getObjectCommand = new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: `${siteId}/${branch}/raw/${path}`
      });

      const response = await s3Client.send(getObjectCommand);
      const content = await response.Body.transformToString();

      console.log('Processing markdown file:', path);

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

      console.log(`Successfully processed ${path}`);
      return new Response('Successfully processed file', { status: 200 });

    } catch (error) {
      console.error('Error processing file:', error);
      return new Response(`Error processing file: ${error}`, { status: 500 });
    }
  }
};