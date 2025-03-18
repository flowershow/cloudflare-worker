DROP TABLE IF EXISTS "Blob";
DROP TABLE IF EXISTS "Site";

CREATE TABLE "Site" (
    id TEXT PRIMARY KEY,
    gh_repository TEXT NOT NULL,
    gh_branch TEXT NOT NULL,
    subdomain TEXT UNIQUE,
    "customDomain" TEXT UNIQUE,
    "rootDir" TEXT,
    "projectName" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "autoSync" BOOLEAN NOT NULL DEFAULT false,
    "webhookId" TEXT UNIQUE,
    "enableComments" BOOLEAN NOT NULL DEFAULT false,
    "giscusRepoId" TEXT,
    "giscusCategoryId" TEXT,
    plan TEXT NOT NULL DEFAULT 'FREE',
    tree JSONB,
    UNIQUE("userId", "projectName")
);

CREATE INDEX "Site_userId_idx" ON "Site"("userId");

CREATE TABLE "Blob" (
    id TEXT PRIMARY KEY,
    "siteId" TEXT NOT NULL REFERENCES "Site"(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    "appPath" TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    extension TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("siteId", path),
    UNIQUE("siteId", "appPath")
);

CREATE INDEX "Blob_siteId_idx" ON "Blob"("siteId");
CREATE INDEX "Blob_appPath_idx" ON "Blob"("appPath");