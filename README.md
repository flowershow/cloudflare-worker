# Markdown Parser Worker

A Cloudflare worker that processes markdown files saved to S3, extracting metadata and updating the database. The worker receives HTTP requests from Inngest when files are saved.

## Features

- Processes markdown (.md) and MDX (.mdx) files
- Extracts metadata from frontmatter (currently title)
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
cp .env.example .env
```

4. Fill in your .env with the required values. For local development with MinIO:
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

5. Generate Prisma client:
```bash
npx prisma generate
```

## Local Development

1. Ensure MinIO is running locally (default endpoint: http://localhost:9000)

2. Start the worker locally:
```bash
npm run dev
```
This will start the worker at http://localhost:8787

3. Configure your Inngest function to send HTTP requests to http://localhost:8787 for local development.

4. Test the worker by sending a POST request:
```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"siteId": "your-site-id", "blobId": "your-blob-id", "path": "path/to/your/file.md"}'
```

The worker expects the following parameters in the request body:
- `siteId`: The ID of the site the file belongs to
- `blobId`: The ID of the blob record to update
- `path`: The path to the markdown file in S3

## Production Deployment

1. Configure environment variables in the Cloudflare dashboard:
   - S3_ACCESS_KEY_ID
   - S3_SECRET_ACCESS_KEY
   - S3_REGION (optional, defaults to us-east-1)
   - S3_BUCKET
   - DATABASE_URL
   - S3_ENDPOINT (must include protocol, e.g., https://your-bucket.r2.cloudflarestorage.com)
   - S3_FORCE_PATH_STYLE

2. Deploy the worker:
```bash
npm run deploy
```

3. Update your Inngest function to use the Cloudflare Workers URL.

## Project Structure

- `src/worker.js` - Main worker file that handles HTTP requests
- `src/parser.js` - Markdown parsing and metadata extraction
- `wrangler.toml` - Cloudflare Workers configuration
- `.env.example` - Example environment variables
- `prisma/schema.prisma` - Database schema

## Extending Metadata Extraction

To extract additional metadata from markdown files, modify the `parseMarkdownFile` function in `src/parser.js`. Currently, it only extracts the title from frontmatter, but you can extend it to extract more fields as needed.

## Error Handling

The worker includes error handling for:
- Missing or invalid request parameters
- Invalid file types (non-markdown files)
- S3/MinIO access issues
- Invalid S3 endpoint configuration
- Markdown parsing errors
- Database update failures
- Missing or invalid configuration

All errors are logged and appropriate HTTP responses are returned.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
