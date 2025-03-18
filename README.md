# Markdown Parser Worker

A Cloudflare worker that processes markdown files saved to S3, extracting metadata and updating the database. The worker exposes an HTTP endpoint that processes markdown files and updates metadata in the database.

## Features

- Processes markdown (.md) and MDX (.mdx) files
- Extracts metadata from frontmatter (title and description)
- Falls back to intelligent content parsing if frontmatter is missing
- Updates Blob records in the database with extracted metadata
- Works with AWS S3 storage and MinIO for local development

## Prerequisites

- Node.js and npm installed
- MinIO running locally (for development)
- PostgreSQL database
- Cloudflare account (for production deployment)

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

## Local Development

1. Ensure MinIO is running locally (default endpoint: http://localhost:9000)

2. Start the worker locally:
```bash
npm run dev
```
This will start the worker at http://localhost:8787

## API Usage

The worker exposes a single HTTP endpoint that accepts POST requests. Here's how to use it:

### Request

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"siteId": "your-site-id", "blobId": "your-blob-id", "path": "path/to/your/file.md", "branch": "main"}'
```

#### Parameters

- `siteId`: The ID of the site the file belongs to
- `blobId`: The ID of the blob record to update
- `path`: The path to the markdown file in the site content folder (repository)
- `branch`: The branch name (used to construct the S3 key path as `${siteId}/${branch}/raw/${path}`)

### Response

The endpoint returns a JSON response with the extracted metadata:

```json
{
  "title": "Extracted title",
  "description": "Extracted description..."
}
```

### Error Responses

- `400 Bad Request`: Missing required parameters (siteId, blobId, path, or branch)
- `500 Internal Server Error`: Processing errors (S3 access, parsing, database updates)

## Production Deployment

1. Deploy the worker:
```bash
npm run deploy
```

2. Configure environment variables for the worker in the Cloudflare dashboard:
   - S3_ACCESS_KEY_ID
   - S3_SECRET_ACCESS_KEY
   - S3_REGION (optional, defaults to us-east-1)
   - S3_BUCKET
   - DATABASE_URL
   - S3_ENDPOINT (must include protocol, e.g., https://your-bucket.r2.cloudflarestorage.com)
   - S3_FORCE_PATH_STYLE


## Project Structure

- `src/worker.js` - Main worker file that handles HTTP requests
- `src/parser.js` - Markdown parsing and metadata extraction
- `wrangler.toml` - Cloudflare Workers configuration (with Node.js compatibility mode)
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
