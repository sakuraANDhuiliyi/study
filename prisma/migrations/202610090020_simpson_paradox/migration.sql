-- Recommend the classroom comparison only in its four related public major templates.
-- Preserve curriculum order, institutional customizations and learner preferences.
UPDATE "AcademicsMajor"
SET "moduleIds" = array_append("moduleIds", 'simpson-paradox'),
    "revision" = "revision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "organizationId" IS NULL
  AND "id" IN (
    'major-statistics',
    'major-data-science',
    'major-economics',
    'major-marketing'
  )
  AND NOT ('simpson-paradox' = ANY("moduleIds"));
