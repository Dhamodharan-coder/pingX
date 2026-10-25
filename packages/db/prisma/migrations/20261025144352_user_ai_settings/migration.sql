-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('anthropic', 'openai', 'gemini', 'openai_compatible');

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "base_url" TEXT,
    "api_key_enc" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_user_id_key" ON "ai_settings"("user_id");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
