CREATE TABLE "StandaloneNote" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" TEXT NOT NULL CHECK (octet_length("title") BETWEEN 1 AND 480),
  "category" TEXT CHECK ("category" IS NULL OR octet_length("category") BETWEEN 1 AND 240),
  "body" TEXT NOT NULL CHECK (octet_length("body") BETWEEN 1 AND 40000),
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE INDEX "StandaloneNote_owner_list_idx"
  ON "StandaloneNote" ("organizationId", "userId", "pinned" DESC, "updatedAt" DESC, "id");
