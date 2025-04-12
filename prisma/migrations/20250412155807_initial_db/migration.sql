-- CreateTable
CREATE TABLE "mapping_configurations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "fhirResourceType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "transformationType" TEXT,
    "transformationDetails" JSONB,
    "defaultValue" TEXT,
    "mappingConfigurationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "field_mappings_mappingConfigurationId_fkey" FOREIGN KEY ("mappingConfigurationId") REFERENCES "mapping_configurations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "mapping_configurations_name_key" ON "mapping_configurations"("name");

-- CreateIndex
CREATE INDEX "mapping_configurations_name_idx" ON "mapping_configurations"("name");

-- CreateIndex
CREATE INDEX "field_mappings_mappingConfigurationId_idx" ON "field_mappings"("mappingConfigurationId");
