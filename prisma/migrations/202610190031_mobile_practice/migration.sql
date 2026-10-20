ALTER TABLE "PracticeSession" ADD COLUMN "mobileCreateKey" VARCHAR(100), ADD COLUMN "mobileCreateHash" VARCHAR(64);
CREATE UNIQUE INDEX "PracticeSession_userId_mobileCreateKey_key" ON "PracticeSession"("userId", "mobileCreateKey");
