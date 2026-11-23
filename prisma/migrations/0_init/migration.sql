-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerWord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "response" TEXT NOT NULL,
    "matchMode" TEXT NOT NULL DEFAULT 'exact',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlarmChannel" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlarmChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SongList" (
    "id" TEXT NOT NULL,
    "songName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SongList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeChannel" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapedCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "rewards" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerWord_key_key" ON "TriggerWord"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AlarmChannel_channelId_key" ON "AlarmChannel"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "SongList_songName_key" ON "SongList"("songName");

-- CreateIndex
CREATE UNIQUE INDEX "CodeChannel_channelId_gameType_key" ON "CodeChannel"("channelId", "gameType");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapedCode_code_game_key" ON "ScrapedCode"("code", "game");

-- CreateIndex
CREATE INDEX "UserMemory_userId_guildId_channelId_idx" ON "UserMemory"("userId", "guildId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_userId_guildId_channelId_key_key" ON "UserMemory"("userId", "guildId", "channelId", "key");