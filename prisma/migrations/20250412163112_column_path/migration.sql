/*
  Warnings:

  - You are about to drop the column `targetPath` on the `field_mappings` table. All the data in the column will be lost.
  - Added the required column `targetFhirPath` to the `field_mappings` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_field_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePath" TEXT NOT NULL,
    "targetFhirPath" TEXT NOT NULL,
    "transformationType" TEXT,
    "transformationDetails" JSONB,
    "defaultValue" TEXT,
    "mappingConfigurationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "field_mappings_mappingConfigurationId_fkey" FOREIGN KEY ("mappingConfigurationId") REFERENCES "mapping_configurations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_field_mappings" ("createdAt", "defaultValue", "id", "mappingConfigurationId", "sourcePath", "transformationDetails", "transformationType", "updatedAt") SELECT "createdAt", "defaultValue", "id", "mappingConfigurationId", "sourcePath", "transformationDetails", "transformationType", "updatedAt" FROM "field_mappings";
DROP TABLE "field_mappings";
ALTER TABLE "new_field_mappings" RENAME TO "field_mappings";
CREATE INDEX "field_mappings_mappingConfigurationId_idx" ON "field_mappings"("mappingConfigurationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
