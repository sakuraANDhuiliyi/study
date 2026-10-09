-- Persist random aliases instead of deriving a public label from an account ID.
CREATE TABLE "AlgorithmForumAlias" (
  "authorId" TEXT NOT NULL,
  "contextKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlgorithmForumAlias_pkey" PRIMARY KEY ("authorId", "contextKey"),
  CONSTRAINT "AlgorithmForumAlias_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AlgorithmForumAlias_label_key" ON "AlgorithmForumAlias"("label");

-- Include historical replies and deleted posts so their alias remains stable.
INSERT INTO "AlgorithmForumAlias" ("authorId", "contextKey", "label")
SELECT a."authorId", a."contextKey", '学习者·' || right(replace(gen_random_uuid()::text, '-', ''), 16)
FROM (
  SELECT "authorId", CASE WHEN scope = 'public' THEN 'public' ELSE 'organization:' || "organizationId" END AS "contextKey"
  FROM "AlgorithmForumPost"
  UNION
  SELECT r."authorId", CASE WHEN p.scope = 'public' THEN 'public' ELSE 'organization:' || p."organizationId" END
  FROM "AlgorithmForumReply" r JOIN "AlgorithmForumPost" p ON p.id = r."postId"
) a JOIN "User" u ON u.id = a."authorId";
