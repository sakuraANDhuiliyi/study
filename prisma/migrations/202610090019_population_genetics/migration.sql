-- Append the new classroom experiment to the five related public templates.
-- Preserve existing order, custom institution curricula and learner preferences.
UPDATE "AcademicsMajor"
SET "moduleIds" = array_append("moduleIds", 'population-genetics'),
    "revision" = "revision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "organizationId" IS NULL
  AND "id" IN (
    'major-biology',
    'major-ecology',
    'major-agronomy',
    'major-horticulture',
    'major-animal-science'
  )
  AND NOT ('population-genetics' = ANY("moduleIds"));
