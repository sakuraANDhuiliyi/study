CREATE TABLE "ProgrammingCreativeFavorite" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "creativeId" TEXT NOT NULL CHECK ("creativeId" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "ProgrammingCreativeFavorite_owner_item_key" ON "ProgrammingCreativeFavorite"("organizationId", "userId", "creativeId");
CREATE INDEX "ProgrammingCreativeFavorite_owner_history_idx" ON "ProgrammingCreativeFavorite"("organizationId", "userId", "updatedAt", "id");
CREATE INDEX "ProgrammingCreativeFavorite_userId_idx" ON "ProgrammingCreativeFavorite"("userId");
