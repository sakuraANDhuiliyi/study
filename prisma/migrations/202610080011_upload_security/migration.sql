CREATE TABLE "UploadOperation" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purpose" TEXT NOT NULL DEFAULT 'upload' CHECK ("purpose" IN ('upload', 'export')),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'completed', 'failed')),
  "reservedBytes" INTEGER NOT NULL CHECK ("reservedBytes" > 0),
  "storageKey" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "UploadOperation_organizationId_ownerId_createdAt_idx" ON "UploadOperation"("organizationId", "ownerId", "createdAt");
CREATE INDEX "UploadOperation_status_expiresAt_idx" ON "UploadOperation"("status", "expiresAt");
ALTER TABLE "Attachment" ADD COLUMN "claimedAt" TIMESTAMPTZ(3);

-- Claim references in the same transaction as the business write. Updating the
-- attachment row serializes new references against deletion/expiry cleanup.
CREATE FUNCTION claim_attachment_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data JSONB := to_jsonb(NEW);
  field_name TEXT;
  item JSONB;
  ids TEXT[] := ARRAY[]::TEXT[];
  attachment_id TEXT;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    item := row_data -> field_name;
    IF jsonb_typeof(item) = 'array' THEN
      ids := ids || ARRAY(SELECT jsonb_array_elements_text(item));
    ELSIF jsonb_typeof(item) = 'string' THEN
      ids := array_append(ids, item #>> '{}');
    END IF;
  END LOOP;
  FOR attachment_id IN SELECT DISTINCT value FROM unnest(ids) AS value ORDER BY value LOOP
    UPDATE "Attachment" SET "claimedAt" = COALESCE("claimedAt", CURRENT_TIMESTAMP) WHERE id = attachment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attachment is no longer available' USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER claim_discussion_attachments BEFORE INSERT OR UPDATE OF "attachmentIds" ON "DiscussionPost"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentIds');
CREATE TRIGGER claim_reply_attachments BEFORE INSERT OR UPDATE OF "attachmentIds" ON "DiscussionReply"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentIds');
CREATE TRIGGER claim_message_attachments BEFORE INSERT OR UPDATE OF "attachmentIds" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentIds');
CREATE TRIGGER claim_lesson_attachments BEFORE INSERT OR UPDATE OF "attachmentId", "attachmentIds" ON "Lesson"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentId', 'attachmentIds');
CREATE TRIGGER claim_assignment_attachments BEFORE INSERT OR UPDATE OF "attachmentIds" ON "Assignment"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentIds');
CREATE TRIGGER claim_assignment_draft_attachments BEFORE INSERT OR UPDATE OF "attachmentIds" ON "AssignmentDraft"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentIds');
CREATE TRIGGER claim_submission_attachments BEFORE INSERT OR UPDATE OF "attachmentIds" ON "AssignmentSubmission"
  FOR EACH ROW EXECUTE FUNCTION claim_attachment_references('attachmentIds');

UPDATE "Attachment" a SET "claimedAt" = CURRENT_TIMESTAMP WHERE
  a."exportJobId" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "DiscussionPost" x WHERE a.id = ANY(x."attachmentIds"))
  OR EXISTS (SELECT 1 FROM "DiscussionReply" x WHERE a.id = ANY(x."attachmentIds"))
  OR EXISTS (SELECT 1 FROM "Message" x WHERE a.id = ANY(x."attachmentIds"))
  OR EXISTS (SELECT 1 FROM "Lesson" x WHERE x."attachmentId" = a.id OR a.id = ANY(x."attachmentIds"))
  OR EXISTS (SELECT 1 FROM "Assignment" x WHERE a.id = ANY(x."attachmentIds"))
  OR EXISTS (SELECT 1 FROM "AssignmentDraft" x WHERE a.id = ANY(x."attachmentIds"))
  OR EXISTS (SELECT 1 FROM "AssignmentSubmission" x WHERE a.id = ANY(x."attachmentIds"));
CREATE INDEX "Attachment_unclaimed_createdAt_idx" ON "Attachment"("createdAt") WHERE "claimedAt" IS NULL AND "exportJobId" IS NULL;
