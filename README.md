# Markdown Parser Worker

A Cloudflare worker that automatically processes markdown files when they are uploaded to S3. The worker uses Cloudflare Queues to reliably process files and update metadata in the database.

## Features

- Automatically triggered by S3 file uploads
- Processes markdown (.md) and MDX (.mdx) files
- Extracts metadata from frontmatter (title and description)
- Falls back to intelligent content parsing if frontmatter is missing
- Updates Blob records in the database with extracted metadata
- Uses queues for reliable processing with retries
- Works with AWS S3 storage and MinIO for local development

## Prerequisites

- Node.js and npm installed
- MinIO running locally (for development)
- PostgreSQL database
- Cloudflare account (for production deployment)
- MinIO Client (mc) installed

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Create a local environment file:
```bash
cp .dev.vars.example .dev.vars
```

4. Fill in your .dev.vars with the required values. For local development with MinIO:
```
# Database Configuration
DATABASE_URL=postgresql://postgres@localhost:5432/datahub-next-dev?schema=public

# S3 Configuration (using MinIO for local development)
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1  # Optional, defaults to us-east-1 for MinIO
S3_BUCKET=datahub
S3_ENDPOINT=http://localhost:9000  # Must include protocol (http:// or https://)
S3_FORCE_PATH_STYLE=true
```

## Local Development and Testing

1. Create the development queue:
```bash
npx wrangler queues create markdown-file-processor-queue-dev
```

2. Start the worker in development mode:
```bash
npm run dev
```
This will start the worker at http://localhost:8787

### Setting up MinIO Client

1. Configure MinIO client alias (only need to do this once):
```bash
mc alias set local http://localhost:9000 minioadmin minioadmin
```

2. Create the test bucket if it doesn't exist:
```bash
mc mb local/datahub
```

3. Test the connection:
```bash
mc ls local/datahub
```

Important: When using MinIO client (mc), always use the configured alias (e.g., 'local') to interact with the MinIO server:
- ❌ `mc cp test.md minio/datahub/...` - Wrong: copies to local directory
- ✅ `mc cp test.md local/datahub/...` - Correct: uploads to MinIO server

### Setting up MinIO Event Notifications

1. Access the MinIO Console (usually at http://localhost:9001)

2. Log in with your credentials (default: minioadmin/minioadmin)

3. Configure Event Notifications:
   - Go to Buckets → datahub → Events
   - Click "Add Event Destination"
   - Select "Webhook" as the destination type
   - Set the Webhook URL to your local worker: http://localhost:8787
   - Configure Event Types:
     - Select "put" event (for object creation)
     - Optionally add "delete" if you need to handle file deletions
   - Set Prefix and Suffix filters:
     - Prefix: Leave empty to catch all uploads
     - Suffix: .md,.mdx (to only trigger on markdown files)
   - Save the configuration

### Testing with MinIO

You can test the worker by uploading and deleting files:

1. Upload a test file:
```bash
# Upload a markdown file
mc cp test/test.md local/datahub/test-site/main/raw/test.md
```

2. Delete a test file:
```bash
# Delete a markdown file
mc rm local/datahub/test-site/main/raw/test.md
```

The worker will:
1. Receive the MinIO event
2. Queue the file for processing
3. Process the queued event
4. Update the blob metadata in the database

You can monitor the worker logs in the development terminal to track processing status and any errors.

Note: Ensure your database has a blob record for the test file path before testing.

## File Processing

The worker processes files uploaded to S3 at the following path pattern:
```
/{siteId}/{branch}/raw/{pathtofile}
```

For example:
```
/my-site/main/raw/blog/welcome.md
```

When a file is uploaded:
1. The worker receives an S3 event notification
2. The event is queued for processing
3. The worker processes the queued event:
   - Extracts file metadata
   - Updates the corresponding blob record in the database
4. If processing fails, the event is automatically retried

## Queue Management

The worker uses separate queues for development and production:

- Development: `markdown-file-processor-queue-dev`
  - Used when running `npm run dev`
  - Isolated from production events
  - Good for testing without affecting production data

- Production: `markdown-file-processor-queue`
  - Used when deployed to Cloudflare
  - Handles real S3 events
  - Configured with appropriate retry policies

This separation ensures that development testing doesn't interfere with production processing.

## Production Deployment

1. Create the production queue:
```bash
npx wrangler queues create markdown-file-processor-queue
```

2. Deploy the worker:
```bash
npm run deploy
```

3. Configure environment variables for the worker in the Cloudflare dashboard:
   - S3_ACCESS_KEY_ID
   - S3_SECRET_ACCESS_KEY
   - S3_REGION (optional, defaults to us-east-1)
   - S3_BUCKET
   - DATABASE_URL
   - S3_ENDPOINT (must include protocol, e.g., https://your-bucket.r2.cloudflarestorage.com)
   - S3_FORCE_PATH_STYLE

4. Configure your S3 bucket to send event notifications to the worker's endpoint.

## Project Structure

- `src/worker.js` - Main worker file that handles S3 events and queue processing
- `src/parser.js` - Markdown parsing and metadata extraction
- `test/test.md` - Sample markdown file for testing
- `wrangler.toml` - Cloudflare Workers configuration
- `.dev.vars.example` - Example environment variables

## Metadata Extraction

The worker extracts the following metadata from markdown files:

### Title
1. Uses frontmatter `title` field if present
2. Falls back to first H1 heading in the content
3. If no title is found, uses the filename (without extension)

### Description
1. Uses frontmatter `description` field if present
2. Falls back to extracting first 200 characters of content

To extract additional metadata, modify the `parseMarkdownFile` function in `src/parser.js`.
