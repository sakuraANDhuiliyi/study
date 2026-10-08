-- Detailed statistics tables and point/residual views for 500 observations need more than 96 KiB.
-- Keep both input and output bounded; expand only the authored result envelope.
ALTER TABLE "AcademicsRecord" DROP CONSTRAINT "AcademicsRecord_result_check";
ALTER TABLE "AcademicsRecord" ADD CONSTRAINT "AcademicsRecord_result_check" CHECK (octet_length("result"::text) <= 262144);
