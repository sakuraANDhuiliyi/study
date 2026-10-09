-- Existing private drafts remain intact and become revision 0.
ALTER TABLE "AlgorithmDraft" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
