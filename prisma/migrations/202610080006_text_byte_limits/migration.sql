-- API validation enforces character limits. Conservative UTF-8 byte bounds also
-- work with legacy SQL_ASCII development databases, where char_length counts bytes.
ALTER TABLE "PersonalTask" DROP CONSTRAINT "PersonalTask_title_check";
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_title_check" CHECK (octet_length("title") BETWEEN 1 AND 640);
ALTER TABLE "PersonalTask" DROP CONSTRAINT "PersonalTask_description_check";
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_description_check" CHECK (octet_length("description") <= 40000);
ALTER TABLE "LessonNote" DROP CONSTRAINT "LessonNote_body_length";
ALTER TABLE "LessonNote" ADD CONSTRAINT "LessonNote_body_length" CHECK (octet_length("body") BETWEEN 1 AND 40000);
