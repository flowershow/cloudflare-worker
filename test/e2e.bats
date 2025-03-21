#!/usr/bin/env bats

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

setup() {
    # Configure MinIO client
    mc alias set local http://localhost:9000 minioadmin minioadmin
    
    # Test parameters
    export SITE_ID="test-site-123"
    export BRANCH="main"
    export PATH_IN_REPO="articles/test.md"
    export BLOB_ID="test-blob-123"
    
    # Ensure worker is not running
    pkill -f "wrangler dev" || true
    sleep 2

    # Create test site in database
    psql postgresql://postgres:postgres@localhost:5432/datahub-next-dev -c \
        "INSERT INTO \"Site\" (id, gh_repository, gh_branch, \"projectName\", \"createdAt\", \"updatedAt\") 
         VALUES ('$SITE_ID', 'test/repo', 'main', 'Test Project', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING;"

    # Create blob for test file
    psql postgresql://postgres:postgres@localhost:5432/datahub-next-dev -c \
        "INSERT INTO \"Blob\" (id, \"siteId\", path, \"appPath\", size, sha, metadata, \"createdAt\", \"updatedAt\") 
         VALUES ('$BLOB_ID', '$SITE_ID', '$PATH_IN_REPO', 'articles/test', 100, 'test-sha', '{}'::jsonb, NOW(), NOW())
         ON CONFLICT (\"siteId\", path) DO NOTHING;"
}

teardown() {
    pkill -f "wrangler dev" || true

    # Clean up test data
    # psql postgresql://postgres:postgres@localhost:5432/datahub-next-dev -c \
    #    "DELETE FROM \"Site\" WHERE id = '$SITE_ID';"
}

@test "Full E2E flow: Upload file -> Process -> Update DB" {
    # Start worker in background
    npm run dev &
    sleep 5  # Wait for worker to start
    
    # Upload test file to MinIO
    mc cp \
        test/test.md \
        local/datahub/$SITE_ID/$BRANCH/raw/$PATH_IN_REPO
    
    # Wait longer for processing
    sleep 10
    
    # Debug: Show current metadata
    echo "Current blob metadata:"
    psql postgresql://postgres:postgres@localhost:5432/datahub-next-dev -c \
        "SELECT metadata FROM \"Blob\" 
         WHERE \"siteId\" = '$SITE_ID' 
         AND path = '$PATH_IN_REPO';"
    
    # Verify database was updated with correct metadata
    result=$(psql postgresql://postgres:postgres@localhost:5432/datahub-next-dev -t -c \
        "SELECT metadata FROM \"Blob\" 
         WHERE \"siteId\" = '$SITE_ID' 
         AND path = '$PATH_IN_REPO' 
         LIMIT 1;")
    
    # Use bats-assert for better error messages
    assert [ ! -z "$result" ]
    
    # Extract and verify each field
    title=$(echo "$result" | jq -r '.title')
    description=$(echo "$result" | jq -r '.description')
    date=$(echo "$result" | jq -r '.date')
    
    assert_equal "$title" "Test Article"
    assert_equal "$description" "A test markdown file for local development"
    assert_equal "$date" "2024-03-20T00:00:00.000Z"
}