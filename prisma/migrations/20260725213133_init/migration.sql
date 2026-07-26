-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "intent" TEXT,
    "pageTypeId" TEXT,
    "clusterKey" TEXT,
    "matchCount" INTEGER,
    "volume" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlpPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keywordId" TEXT,
    "pageTypeId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "intent" TEXT NOT NULL,
    "productIds" TEXT NOT NULL,
    "content" TEXT,
    "seo" TEXT,
    "reviewReason" TEXT,
    "clusterKey" TEXT,
    "canonicalOfId" TEXT,
    "articleId" TEXT,
    "articleUrl" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlpPage_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "brandName" TEXT NOT NULL DEFAULT 'Wild Palace',
    "brandTone" TEXT NOT NULL DEFAULT 'Premium but warm; expert interior-design voice; concrete and specific; never salesy filler.',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en-US',
    "enabledLocales" TEXT NOT NULL DEFAULT '["en-US", "de-DE"]',
    "competitorUrls" TEXT NOT NULL DEFAULT '[]',
    "blogHandle" TEXT NOT NULL DEFAULT 'seo-plp',
    "minProducts" INTEGER NOT NULL DEFAULT 6,
    "catalogSeeded" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "Keyword_shop_status_idx" ON "Keyword"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_shop_phrase_locale_key" ON "Keyword"("shop", "phrase", "locale");

-- CreateIndex
CREATE INDEX "PlpPage_shop_status_idx" ON "PlpPage"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlpPage_shop_slug_locale_key" ON "PlpPage"("shop", "slug", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
