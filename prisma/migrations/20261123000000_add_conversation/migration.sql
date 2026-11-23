-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "lastActive" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_lastActive_idx" ON "Conversation"("lastActive");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_guildId_channelId_userId_persona_key" ON "Conversation"("guildId", "channelId", "userId", "persona");
