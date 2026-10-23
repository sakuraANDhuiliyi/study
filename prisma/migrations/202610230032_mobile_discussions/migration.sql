ALTER TABLE "DiscussionPost" ADD COLUMN "mobileCreateKey" VARCHAR(100), ADD COLUMN "mobileCreateHash" VARCHAR(64);
CREATE UNIQUE INDEX "DiscussionPost_authorId_mobileCreateKey_key" ON "DiscussionPost"("authorId", "mobileCreateKey");
ALTER TABLE "DiscussionReply" ADD COLUMN "mobileCreateKey" VARCHAR(100), ADD COLUMN "mobileCreateHash" VARCHAR(64);
CREATE UNIQUE INDEX "DiscussionReply_authorId_mobileCreateKey_key" ON "DiscussionReply"("authorId", "mobileCreateKey");
