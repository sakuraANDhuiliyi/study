CREATE TABLE "AlgorithmForumPost" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "scope" TEXT NOT NULL DEFAULT 'public' CHECK ("scope" IN ('public','organization')),
  "kind" TEXT NOT NULL DEFAULT 'question' CHECK ("kind" IN ('question','solution','discussion')),
  "problemId" TEXT CHECK (octet_length("problemId") <= 100),
  "title" TEXT NOT NULL CHECK (octet_length("title") BETWEEN 1 AND 640),
  "body" TEXT NOT NULL CHECK (octet_length("body") BETWEEN 1 AND 60000),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "closed" BOOLEAN NOT NULL DEFAULT false,
  "solved" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AlgorithmForumPost_public_idx" ON "AlgorithmForumPost"("scope","deletedAt","pinned","createdAt","id");
CREATE INDEX "AlgorithmForumPost_org_idx" ON "AlgorithmForumPost"("organizationId","scope","deletedAt","createdAt","id");
CREATE INDEX "AlgorithmForumPost_problem_idx" ON "AlgorithmForumPost"("problemId","scope","deletedAt","createdAt","id");
CREATE INDEX "AlgorithmForumPost_authorId_createdAt_idx" ON "AlgorithmForumPost"("authorId","createdAt");
CREATE TABLE "AlgorithmForumReply" (
  "id" TEXT PRIMARY KEY,
  "postId" TEXT NOT NULL REFERENCES "AlgorithmForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "body" TEXT NOT NULL CHECK (octet_length("body") BETWEEN 1 AND 60000),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "deletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "AlgorithmForumReply_post_idx" ON "AlgorithmForumReply"("postId","deletedAt","createdAt","id");
CREATE INDEX "AlgorithmForumReply_authorId_createdAt_idx" ON "AlgorithmForumReply"("authorId","createdAt");
