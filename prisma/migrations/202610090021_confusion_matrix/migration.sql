-- Add the binary-classification classroom experiment only to related public templates.
-- Preserve existing order, institution curricula, learner preferences and assignments.
UPDATE "AcademicsMajor"
SET "moduleIds" = array_append("moduleIds", 'confusion-matrix'),
    "revision" = "revision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "organizationId" IS NULL
  AND "id" IN (
    'major-statistics',
    'major-data-science',
    'major-artificial-intelligence'
  )
  AND NOT ('confusion-matrix' = ANY("moduleIds"));
